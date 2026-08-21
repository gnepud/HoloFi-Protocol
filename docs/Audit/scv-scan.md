# HoloFi Protocol 安全扫描报告（scv-scan）

- **扫描范围**：`contracts/` 下全部核心合约（不含 `.t.sol` 测试文件与 `contracts/mocks/`）
- **编译器版本**：Solidity 0.8.28（≥0.8.0，默认含溢出检查）✅
- **依赖**：OpenZeppelin Contracts v5.6.1
- **方法**：速查表模式匹配（Pass A）+ 全量语义审读（Pass B）+ 参考文件逐条验证（Phase 3）

---

## 确认的发现

### 1. ERC-4626 通胀 / 捐赠攻击（缺少虚拟份额偏移）

**文件：** `contracts/HoloFiLendingPool.sol` L18、L117-L119
**严重性：** Medium

**描述：** `HoloFiLendingPool` 继承 OpenZeppelin 的 `ERC4626` 但未重写 `_decimalsOffset()`（默认为 0），即没有虚拟份额/虚拟资产保护。同时 `deposit`/`mint` 完全无准入限制（仅 `whenNotPaused`）。攻击者可作为第一个存款人存入最小单位资产后直接向池子捐赠底层代币抬高 `totalAssets()`，使后续首位真实存款人因舍入获得 0 份额，其存款被攻击者通过赎回吸走。

**代码：**
```solidity
contract HoloFiLendingPool is ERC4626, Pausable {
    // 未重写 _decimalsOffset()，无虚拟份额保护
    function totalAssets() public view virtual override returns (uint256) {
        return super.totalAssets() + totalBorrows;
    }
    // deposit/mint 无任何访问控制
    function deposit(uint256 assets, address receiver) public virtual override whenNotPaused returns (uint256) {
        return super.deposit(assets, receiver);
    }
}
```

**建议：** 重写 `_decimalsOffset()` 返回非零值（如 3~6），引入虚拟份额稀释捐赠攻击收益；或在文档中明确首个存款人由协议部署方完成（种子存款）。参考 OZ ERC4626 文档中 "virtual assets and shares" 一节。

---

### 2. 价格预言机缺乏新鲜度与合理性校验

**文件：** `contracts/HoloFiCardPriceFeed.sol` L46-L80、L83-L87；调用方 `contracts/HoloFiVaultLoanCore.sol` L337-L344、L415-L417
**严重性：** Medium

**描述：** `getPrice()` 原样返回最后写入的价格和 `lastUpdated` 时间戳，但所有调用方（`getVaultFMV`、`_withdrawCollateral`、`startLiquidation` 经由健康因子计算）均忽略 `lastUpdated`，没有任何过期检查。若 ORACLE_ROLE 停止更新或密钥泄露，协议将基于严重过时/被操纵的价格进行借款额度计算与清算判定：价格虚高 → 过度借贷产生坏账；价格虚低 → 用户金库被错误清算。`setPrice` 也无单次更新幅度限制。

**代码：**
```solidity
function getPrice(bytes32 cardTypeId) external view returns (uint256 price, uint128 lastUpdated) {
    PriceData memory data = prices[cardTypeId];
    return (uint256(data.price), data.lastUpdated); // 调用方从不校验 lastUpdated
}
```

**建议：** 在 `LoanCore` 读取价格处增加最大时效窗口（如 `block.timestamp - lastUpdated <= MAX_STALENESS`），过期则拒绝借款/清算；可选增加单次更新最大偏差限制。此风险依赖 ORACLE_ROLE 的可信度，属于中心化信任假设，建议在文档中明示。

---

### 3. 拍卖期间利息流失（清算债务金额冻结）

**文件：** `contracts/HoloFiDutchAuction.sol` L107-L167（`startAuction` 冻结 `debtAmount`）、L160-L196（`settleAuction` 按冻结值结算）
**严重性：** Low

**描述：** `startAuction` 将 `totalDebt`（本金 + 应计利息）快照进拍卖记录。金库进入 `Liquidating` 状态后 `borrow`/`repay`/`withdraw` 全部回退，因此 `accrueInterest` 不再被触发，但 `getPendingInterest` 仍在持续增长。`settleAuction` 只向池子归还快照的 `debtAmount`，拍卖期间（最长 48 小时）新产生的利息无人支付，`finalizeLiquidation` 又将其清零——这部分利息收益从 LP 中流失。

**代码：**
```solidity
// startAuction: 快照
uint256 totalDebt = loanCore.getTotalDebt(vaultId);
...
debtAmount: totalDebt,
// settleAuction: 按快照结算，48h 内新增利息未收取
uint256 debtPaid = auction.debtAmount;
...
HoloFiLendingPool(lendingPool).returnLiquidity(address(this), principalPaid, debtPaid);
```

**建议：** 在 `settleAuction`/`treasuryBuyback` 结算前调用 `loanCore.accrueInterest(vaultId)` 并按实时 `getTotalDebt` 计算应付金额（需相应调整 `reservePrice` 与 `surplus` 计算）；或在文档中明确接受该损耗上限（≤48h 利息）。

---

### 4. 卖家收款失败可阻塞拍卖结算（DoS）

**文件：** `contracts/HoloFiDutchAuction.sol` L196-L199
**严重性：** Low

**描述：** `settleAuction` 将剩余价值 `surplus` 以 `safeTransfer` 直接转给 `auction.seller`（原金库所有者）。若卖家地址在底层代币中被拉黑（如 USDT 黑名单机制）或转账以其他方式失败，整个结算交易回退，清算人无法完成清算，抵押品 NFT 将滞留至拍卖到期后由 `treasuryBuyback` 兜底。属于可被外部条件触发的非关键路径 DoS / 痛苦攻击。

**代码：**
```solidity
// Step 4: Refund residual equity surplus to original store (Vault Owner)
if (surplus > 0) {
    asset.safeTransfer(auction.seller, surplus);
}
```

**建议：** 改为 pull-payment 模式：在合约内记录 `pendingSurplus[vaultId] = surplus`，由卖家自行领取；或捕获转账失败继续结算、将 surplus 记账延后发放。

---

### 5. 直接转入的 NFT 会永久卡死在 LoanCore

**文件：** `contracts/HoloFiVaultLoanCore.sol` L194-L200
**严重性：** Low

**描述：** `onERC721Received` 无条件接受任意来源的 `safeTransferFrom`。卡片持有人若绕过 `depositCollateral` 直接把 `HoloFiVaultCard` 转入本合约，NFT 会进入合约但不会被记入任何金库（`nftVaultId` 不更新、`tokenIds` 不追加），且该卡未被锁定但已不在持有人手中——只能等金库清算遍历 `tokenIds` 时才可能转出，而它不在任何列表里，实际上永久滞留于合约。

**代码：**
```solidity
function onERC721Received(
    address,
    address,
    uint256,
    bytes calldata
) external pure override returns (bytes4) {
    return IERC721Receiver.onERC721Received.selector; // 无条件接受
}
```

**建议：** 在 `onERC721Received` 中校验 `from` 为合法路径（如要求 `msg.sender == address(vaultCard)` 且附带操作上下文），否则返回错误选择器使转账回退；或提供管理员救援函数提取未登记 NFT。

---

### 6. 金库 FMV 计算存在无界循环

**文件：** `contracts/HoloFiVaultLoanCore.sol` L346-L354（`getVaultFMV`）
**严重性：** Low

**描述：** `getVaultFMV` 遍历金库全部 `tokenIds`，数组长度随 `depositCollateral` 无上限增长。单个金库存入极多 NFT 后，`borrow`、`startLiquidation`、`_withdrawCollateral` 等依赖该函数的操作 gas 成本线性上升，极端情况下超出区块 gas 上限导致功能不可用——包括清算流程（`startAuction` 依赖健康因子计算），可能造成池子坏账。由于增长由金库所有者自己控制且同样阻碍自身操作，实际风险有限。

**代码：**
```solidity
function getVaultFMV(uint256 vaultId) public view returns (uint256 totalFmv) {
    uint256[] memory tokenIds = vaults[vaultId].tokenIds;
    for (uint256 i = 0; i < tokenIds.length; i++) { ... }
}
```

**建议：** 在 `depositCollateral` 中限制单金库最大抵押品数量；或维护金库 FMV 的增量缓存（存取与价格更新时增减），避免全量遍历。

---

## 信息级发现

| # | 文件 | 说明 |
|---|------|------|
| I-1 | `contracts/policies/GradeEligibilityPolicy.sol` L44-L56 | `parseGrade` 忽略所有非数字字符（如 `"1a0"` 解析为 10、`"abc"` 解析为 0），可能导致评级字符串被意外归类；超长字符串会因溢出检查导致 `registerCardType` 回退 |
| I-2 | `contracts/HoloFiVaultCard.sol` L124-L140 | `burnCard` 会删除 `isAttestationUsed` 标记，同一实物卡的 attestation 可再次铸造 NFT，请确认是否符合业务预期 |
| I-3 | `contracts/HoloFiDutchAuction.sol` L47 | 错误 `UnregisteredLendingPool` 已声明但从未使用 |
| I-4 | `contracts/HoloFiLendingPool.sol` L131-L135 | `isCollateralAllowed` 在未设置 eligibilityPolicy 时默认放行所有卡类型，请确认是否为有意的宽松默认值 |
| I-5 | `contracts/AccessControlManager.sol` | 所有角色管理无时间锁/多签强制，ADMIN_ROLE 拥有协议全部参数（LTV、利率、dutchAuction 地址、KYB 名单）的单点控制权，属中心化信任假设 |

---

## 已排查并排除的疑点（假阳性）

| 疑点 | 排除理由 |
|------|----------|
| `settleAuction` 重入 | 遵循 checks-effects-interactions（`isSettled = true` 先于所有外部调用），且函数带 `nonReentrant`；NFT 回调再入会被 LoanCore 自身的 `nonReentrant` 阻断 |
| `drawLiquidity` 无 `nonReentrant` | `totalBorrows` 在转账前更新；再入路径要么权限不足（msg.sender ≠ loanCore），要么撞上 LoanCore 的 `nonReentrant` 锁 |
| USDT 兼容性 | 全部 ERC20 操作使用 `SafeERC20`，授权使用 `forceApprove` ✅ |
| 签名相关漏洞 | 合约无 `ecrecover`/链上签名验证 ✅ |
| `tx.origin` / `delegatecall` / `abi.encodePacked` 哈希碰撞 | 全库未使用 ✅ |
| 整数溢出 | Solidity 0.8.28，无 `unchecked`/`assembly` 算术；除法均为先乘后除，`DecimalMath` 截断方向保守（对用户不利方向取整）✅ |
| 利息重复计提 | `accrueInterest` 用向上取整的 `accountedDt` 推进 `lastInterestUpdateTime`，无重复/遗漏计提 ✅ |
| 提现后健康度校验 | 有债提现时正确校验剩余 FMV 的最大借款容量覆盖总债务；无债提现逐个校验归属 ✅ |
| `msg.value` 复用 / 循环内 revert DoS | 不涉及 `msg.value`；循环内转账目标均为可信合约或已在第一步完成收款 ✅ |
| 权限缺失 | 所有状态变更函数均有 ACM 角色校验或所有权/KYB 校验；`startAuction` 无权限属有意设计（许可式清算，受 HF < 1 约束）✅ |

---

## Summary

| 严重性 | 数量 |
|--------|------|
| Critical | 0 |
| High     | 0 |
| Medium   | 2 |
| Low      | 4 |
| Info     | 5 |

**总体评价：** 代码库整体质量较高——统一使用 SafeERC20、关键资金路径均有 `ReentrancyGuard` 且遵循 CEI 顺序、访问控制集中且完整、编译器版本较新。主要风险集中在 ERC-4626 首存人通胀攻击面与预言机价格的新鲜度假设上，建议优先处理两项 Medium 发现。
