import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";

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

  m.call(mockAsset, "mint", [poolAddress, mockMintAmount]);

  return {
    lendingPool,
    mockAsset,
    assetAddress: mockAsset,
  };
});

export default DeployHoloFiLendingPoolWithMock;
