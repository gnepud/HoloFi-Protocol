import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";

const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

const DeployHoloFiLendingPoolWithMock = buildModule("DeployHoloFiLendingPoolWithMock", (m) => {
  const { poolFactory, loanCore } = m.useModule(DeployHoloFiProtocol);

  const mockMintAmount = m.getParameter("mockMintAmount", 1_000_000_000_000n); // 1,000,000 EURC (6 decimals)
  const poolName = m.getParameter("poolName", "Pool EURC");
  const poolSymbol = m.getParameter("poolSymbol", "pEURC");

  const mockAsset = m.contract("MockERC20", ["Euro Coin", "EURC", 6]);

  const createPoolTx = m.call(poolFactory, "createPool", [
    mockAsset,
    poolName,
    poolSymbol,
  ]);

  const poolAddress = m.staticCall(poolFactory, "getPool", [mockAsset], 0, {
    after: [createPoolTx],
  });

  const lendingPool = m.contractAt("HoloFiLendingPool", poolAddress);

  m.call(lendingPool, "setLoanCore", [loanCore]);

  const deployer = m.getAccount(0);

  // Mint mock tokens to deployer
  const mintToDeployerTx = m.call(mockAsset, "mint", [deployer, mockMintAmount], {
    id: "mintMockInitialToDeployer",
  });

  // Approve lending pool to spend deployer's mock tokens
  const approvePoolTx = m.call(mockAsset, "approve", [lendingPool, mockMintAmount], {
    id: "approveLendingPoolInitialDeposit",
    after: [mintToDeployerTx],
  });

  // Deposit initial seed liquidity, locking shares permanently at DEAD address
  m.call(lendingPool, "deposit", [mockMintAmount, DEAD_ADDRESS], {
    id: "depositSeedLiquidityToDeadAddress",
    after: [approvePoolTx],
  });

  return {
    lendingPool,
    mockAsset,
    assetAddress: mockAsset,
  };
});

export default DeployHoloFiLendingPoolWithMock;
