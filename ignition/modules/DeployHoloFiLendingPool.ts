import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";

const DeployHoloFiLendingPool = buildModule("DeployHoloFiLendingPool", (m) => {
  const { acm, poolFactory, loanCore } = m.useModule(DeployHoloFiProtocol);

  const mockMintAmount = m.getParameter("mockMintAmount", 1_000_000_000_000n); // 1,000,000 EURC (6 decimals)
  const poolName = m.getParameter("poolName", "Pool EURC");
  const poolSymbol = m.getParameter("poolSymbol", "pEURC");

  const mockAsset = m.contract("MockERC20", ["Euro Coin", "EURC", 6]);
  const assetAddressParam = m.getParameter("existingAssetAddress", mockAsset);
  const assetAddress = m.contractAt("MockERC20", assetAddressParam);

  // Create pool via factory
  const createPoolTx = m.call(poolFactory, "createPool", [
    assetAddress,
    poolName,
    poolSymbol,
  ]);

  // Query deployed pool address
  const poolAddress = m.staticCall(poolFactory, "getPool", [assetAddress], undefined, {
    after: [createPoolTx],
  });

  // Bind contract instance
  const lendingPool = m.contractAt("HoloFiLendingPool", poolAddress);

  // Set loanCore in lendingPool
  m.call(lendingPool, "setLoanCore", [loanCore]);

  // Mint mock liquidity
  m.call(mockAsset, "mint", [poolAddress, mockMintAmount]);

  return {
    lendingPool,
    assetAddress,
    mockAsset,
  };
});

export default DeployHoloFiLendingPool;

