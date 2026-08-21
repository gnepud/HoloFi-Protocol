# 🔐 Security Review — HoloFi Protocol

Completeness: 9 unique (Contract, function) in raw, 9 covered in final.

---

## Scope

|                                  |                                                        |
| -------------------------------- | ------------------------------------------------------ |
| **Mode**                         | ALL / default                                          |
| **Files reviewed**               | `AccessControlManager.sol` · `HoloFiCardPriceFeed.sol` · `HoloFiDutchAuction.sol`<br>`HoloFiLendingPool.sol` · `HoloFiLendingPoolFactory.sol` · `HoloFiVaultCard.sol`<br>`HoloFiVaultLoanCore.sol` · `DecimalMath.sol` · `GradeEligibilityPolicy.sol` |
| **Confidence threshold (1-100)** | 80                                                     |

---

## Findings

[95] **1. 还款与拍卖结算中包含的利息直接扣减 `totalBorrows` 导致借贷池资产价值被低估与 LP 收益被盗** [agents: 1, 4, 5, 6, 7, 8, 9, 10, 11, 12]

`HoloFiLendingPool.returnLiquidity` · Confidence: 95

**Description**
`HoloFiVaultLoanCore._repay()` 与 `HoloFiDutchAuction.settleAuction()` 将包含利息的总还款额（`principalPaid + interestPaid`）传入 `returnLiquidity()`，导致 `totalBorrows` 扣减了利息金额而低于实际未结清的借款本金，使 ERC-4626 `totalAssets()` 在存在并发贷款时无法体现已支付的利息增值，退出 LP 无法获得利息收益，套利者可在低估净值时存入并在其他贷款结清时抽走被转移的收益。

**Fix (Option A — 仅扣除实际归还的本金)**:

```diff
-   function returnLiquidity(address payer, uint256 amount) external override {
+   function returnLiquidity(address payer, uint256 principalAmount, uint256 totalAmount) external override {
        if (msg.sender != loanCore && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            address auction = IHoloFiVaultLoanCore(loanCore).dutchAuction();
            if (msg.sender != auction) {
                revert UnauthorizedOperator(msg.sender);
            }
        }
-       totalBorrows = (amount >= totalBorrows) ? 0 : (totalBorrows - amount);
-       IERC20(asset()).safeTransferFrom(payer, address(this), amount);
-       emit LiquidityReturned(payer, amount);
+       totalBorrows = (principalAmount >= totalBorrows) ? 0 : (totalBorrows - principalAmount);
+       IERC20(asset()).safeTransferFrom(payer, address(this), totalAmount);
+       emit LiquidityReturned(payer, totalAmount);
    }
```

**Fix (Option B — 在 LoanCore 中分别传递本金与利息)**:

```diff
-   HoloFiLendingPool(vault.lendingPool).returnLiquidity(msg.sender, actualRepay);
+   HoloFiLendingPool(vault.lendingPool).returnLiquidity(msg.sender, principalPaid);
+   if (interestPaid > 0) {
+       IERC20(HoloFiLendingPool(vault.lendingPool).asset()).safeTransferFrom(msg.sender, vault.lendingPool, interestPaid);
+   }
```

---

[95] **2. `parseGrade` 剥离非数字字符导致小数及半级评分被十倍放大，使破损/低分卡牌绕过准入阈值** [agents: 1, 2, 4, 5, 6, 7, 8, 9, 10, 12]

`GradeEligibilityPolicy.parseGrade` · Confidence: 95

**Description**
`parseGrade` 在遍历字符串时跳过了小数点等非数字字符并逐位乘以 10 累加，导致 `"1.5"` 等破损级卡牌被解析为整数 `15` 并通过 `minGrade = 10` 的高门槛池子检验，同时将真正的 Gem Mint `"9.5"` 解析为 `95` 而被 `maxGrade = 10` 错误拒绝。

**Fix**:

```diff
    function parseGrade(string memory gradeStr) public pure returns (uint256) {
        bytes memory b = bytes(gradeStr);
        if (b.length == 0) return 0;
        uint256 res = 0;
        for (uint256 i = 0; i < b.length; i++) {
+           if (b[i] == ".") {
+               break;
+           }
            if (b[i] >= "0" && b[i] <= "9") {
                res = res * 10 + (uint256(uint8(b[i])) - 48);
            }
        }
        return res;
    }
```

---

[92] **3. 整数除法截断归零及无条件重置时间戳导致借款人可通过高频调用永久免息借款** [agents: 1, 2, 4, 5, 6, 7, 9, 10, 11, 12]

`HoloFiVaultLoanCore.accrueInterest` · Confidence: 92

**Description**
`accrueInterest` 在计算时间增量利息 `(principalDebt * rate * dt) / (10000 * 365 days)` 时，针对小额借款在较小 $\Delta t$ 下除法截断为 `0`，但函数无条件将 `lastInterestUpdateTime` 更新至 `block.timestamp`，使借款人可通过脚本定时调用永久抹除利息计提。

**Fix**:

```diff
    function accrueInterest(uint256 vaultId) public returns (uint256) {
        Vault storage vault = vaults[vaultId];
        if (vault.status != VaultStatus.Active && vault.status != VaultStatus.UnderLiquidation) {
            return 0;
        }

        uint256 dt = block.timestamp - vault.lastInterestUpdateTime;
        if (dt == 0 || vault.principalDebt == 0) {
            return 0;
        }

        uint256 borrowRate = HoloFiLendingPool(vault.lendingPool).borrowRateBpsPerYear();
        uint256 interestNew = (vault.principalDebt * borrowRate * dt) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);

        if (interestNew > 0) {
            vault.accumulatedInterest += interestNew;
-           vault.lastInterestUpdateTime = block.timestamp;
+           uint256 accountedDt = (interestNew * BPS_DENOMINATOR * SECONDS_PER_YEAR) / (vault.principalDebt * borrowRate);
+           vault.lastInterestUpdateTime += accountedDt;
            emit InterestAccrued(vaultId, interestNew, vault.accumulatedInterest);
        }

        return interestNew;
    }
```

---

[85] **4. `borrow` 与 `depositCollateral` 未校验 KYB 状态导致被吊销资格的商户仍可无限借贷** [agents: 2, 4, 5, 7, 8, 11, 12]

`HoloFiVaultLoanCore.borrow` · Confidence: 85

**Description**
`createVault` 中严格执行了 `acm.isKybApproved(msg.sender)` 检查，但后续的 `borrow` 和 `depositCollateral` 仅检查了 `vault.owner == msg.sender`，导致因合规/制裁原因被管理员吊销 KYB 资格的商户仍可向已有 Vault 质押并源源不断借出借贷池资金。

**Fix**:

```diff
    function borrow(uint256 vaultId, uint256 amount) external nonReentrant {
        Vault storage vault = vaults[vaultId];
        if (vault.owner != msg.sender) {
            revert UnauthorizedBorrower(msg.sender, vaultId);
        }
+       if (!acm.isKybApproved(msg.sender)) {
+           revert KybRequired(msg.sender);
+       }
        if (vault.status != VaultStatus.Active) {
            revert VaultNotActive(vaultId);
        }
```

---

[84] **5. 拍卖清算向借款人直接推送盈余代币在黑名单限制时代币转账回滚导致清算 DoS** [agents: 6, 7, 9, 12]

`HoloFiDutchAuction.settleAuction` · Confidence: 84

**Description**
`settleAuction` 在拍卖价格高于保留价时（`surplus > 0`）同步执行 `asset.safeTransfer(auction.seller, surplus)`，若违约借款人地址被代币合约（如 USDC/USDT）加入黑名单或拒绝接收代币，结算操作将直接回滚，导致清算人在前 48 小时窗口内无法清算并造成坏账风险敞口扩大。

**Fix**:

```diff
+   mapping(address => uint256) public claimableSurplus;

    function settleAuction(uint256 vaultId) external override nonReentrant whenNotPaused {
        ...
        if (surplus > 0) {
-           asset.safeTransfer(auction.seller, surplus);
+           claimableSurplus[auction.seller] += surplus;
+           emit SurplusClaimable(auction.seller, surplus);
        }
```

---

[75] **6. `ADMIN_ROLE` 将自身设为 RoleAdmin 导致根治理 `DEFAULT_ADMIN_ROLE` 失去管理权**

`AccessControlManager.constructor` · Confidence: 75

**Description**
构造函数中调用 `_setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE)` 使 `ADMIN_ROLE` 脱离了 OpenZeppelin 标准角色继承链，导致仅持有 `DEFAULT_ADMIN_ROLE` 的多签或 Timelock 根治理账户无法授予或撤销协议角色。

---

[75] **7. `GradeEligibilityPolicy` 的 `onlyMinter` 修饰器缺失 `ADMIN_ROLE` 权限**

`GradeEligibilityPolicy.registerCardType` · Confidence: 75

**Description**
`GradeEligibilityPolicy` 中的 `onlyMinter` 仅判断了 `MINTER_ROLE` 而未如同协议内其他合约一样同时允许 `ADMIN_ROLE`，导致协议管理员在未显式被授予 `MINTER_ROLE` 时无法直接管理卡牌评级策略及覆盖配置。

---

[75] **8. 借贷池更新借款利率时未同步已存续 Vault 的利息快照导致历史区间被追溯计息**

`HoloFiLendingPool.setRiskParameters` · Confidence: 75

**Description**
管理员调用 `setRiskParameters` 调整 `borrowRateBpsPerYear` 时，缺乏全局借款累积指数（Borrow Index），导致在此之前未交互的活跃 Vault 在下次结算时以新利率追溯计算过去整个未结息时间段的利息。

---

Findings List

| # | Confidence | Title |
|---|---|---|
| 1 | [95] | 还款与拍卖结算中包含的利息直接扣减 `totalBorrows` 导致借贷池资产价值被低估与 LP 收益被盗 |
| 2 | [95] | `parseGrade` 剥离非数字字符导致小数及半级评分被十倍放大，使破损/低分卡牌绕过准入阈值 |
| 3 | [92] | 整数除法截断归零及无条件重置时间戳导致借款人可通过高频调用永久免息借款 |
| 4 | [85] | `borrow` 与 `depositCollateral` 未校验 KYB 状态导致被吊销资格的商户仍可无限借贷 |
| 5 | [84] | 拍卖清算向借款人直接推送盈余代币在黑名单限制时代币转账回滚导致清算 DoS |
| 6 | [75] | `ADMIN_ROLE` 将自身设为 RoleAdmin 导致根治理 `DEFAULT_ADMIN_ROLE` 失去管理权 |
| 7 | [75] | `GradeEligibilityPolicy` 的 `onlyMinter` 修饰器缺失 `ADMIN_ROLE` 权限 |
| 8 | [75] | 借贷池更新借款利率时未同步已存续 Vault 的利息快照导致历史区间被追溯计息 |

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in one analysis pass. These are not false positives — they are high-signal leads for manual review. Not scored._

- **Health Factor 预先降精度除法截断** — `HoloFiVaultLoanCore.getHealthFactor` — Code smells: 先除以目标代币精度后再放大 1e18（先除后乘） — 在超低精度代币或微额抵押品场景下，可能导致健康度计算过早归零而触发非预期清算。
- **预言机价格未校验过期时间** — `HoloFiVaultLoanCore.getVaultFMV` — Code smells: `(uint256 price, ) = priceFeed.getPrice(...)` 丢弃了 `lastUpdated` — 预言机宕机或停止更新时，核心合约仍会在无限期过期的历史估值上执行借贷与抵押提取。
- **过期荷兰拍卖国库回购免缴清算罚息** — `HoloFiDutchAuction.treasuryBuyback` — Code smells: `settleAuction` 收取清算罚息并支付给借贷池，而 `treasuryBuyback` 仅归还本金+利息 `debtPaid` — 拍卖流拍后国库以成本价兜底，未向存款池支付惩罚性收益。

---

> ⚠️ This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended. For a consultation regarding your projects' security, visit [https://www.pashov.com](https://www.pashov.com)
