import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";

const DeployHoloFiLendingPool = buildModule("DeployHoloFiLendingPool", (m) => {
  const { acm, poolFactory, loanCore } = m.useModule(DeployHoloFiProtocol);

  const useMockToken = m.getParameter("useMockToken", true);
  const existingAssetAddress = m.getParameter("existingAssetAddress", "");
  const mockMintAmount = m.getParameter("mockMintAmount", 1_000_000_000_000n); // 1,000,000 EURC (6 decimals)
  const poolName = m.getParameter("poolName", "Pool EURC");
  const poolSymbol = m.getParameter("poolSymbol", "pEURC");

  let mockAsset;

  if (useMockToken) {
    mockAsset = m.contract("MockERC20", ["Euro Coin", "EURC", 6]);
  } else {
    mockAsset = m.contractAt("MockERC20", existingAssetAddress);
  }

  const assetAddress = mockAsset;

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

  // Mint mock liquidity if mock token used
  if (useMockToken) {
    m.call(mockAsset, "mint", [poolAddress, mockMintAmount]);
  }

  return {
    lendingPool,
    assetAddress,
    mockAsset,
  };
});

export default DeployHoloFiLendingPool;
