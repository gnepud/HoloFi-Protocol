import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";

const DeployHoloFiLendingPool = buildModule("DeployHoloFiLendingPool", (m) => {
  const protocol = m.useModule(DeployHoloFiProtocol);

  const existingAssetAddress = m.getParameter("existingAssetAddress");
  const asset = m.contractAt("MockERC20", existingAssetAddress);

  // Pool 1: Premium Pool EURC (pEURC)
  const premiumPoolName = m.getParameter("premiumPoolName", "Premium Pool EURC");
  const premiumPoolSymbol = m.getParameter("premiumPoolSymbol", "pEURC");
  const premiumMaxLtvBps = m.getParameter("premiumMaxLtvBps", 5000n); // 50%
  const premiumLiquidationThresholdBps = m.getParameter("premiumLiquidationThresholdBps", 7000n); // 70%
  const premiumLiquidationPenaltyBps = m.getParameter("premiumLiquidationPenaltyBps", 1000n); // 10%
  const premiumBorrowRateBpsPerYear = m.getParameter("premiumBorrowRateBpsPerYear", 500n); // 5%

  const createPremiumPoolTx = m.call(protocol.poolFactory, "createPool", [
    asset,
    premiumPoolName,
    premiumPoolSymbol,
    premiumMaxLtvBps,
    premiumLiquidationThresholdBps,
    premiumLiquidationPenaltyBps,
    premiumBorrowRateBpsPerYear,
  ], { id: "createPremiumPool" });

  const premiumPoolAddress = m.staticCall(protocol.poolFactory, "allPools", [0n], 0, {
    id: "getPremiumPoolAddress",
    after: [createPremiumPoolTx],
  });
  const premiumLendingPool = m.contractAt("HoloFiLendingPool", premiumPoolAddress, {
    id: "PremiumLendingPool",
  });
  m.call(premiumLendingPool, "setLoanCore", [protocol.loanCore], { id: "setLoanCorePremiumPool" });

  // Pool 2: Deluxe Pool EURC (dEURC)
  const deluxePoolName = m.getParameter("deluxePoolName", "Deluxe Pool EURC");
  const deluxePoolSymbol = m.getParameter("deluxePoolSymbol", "dEURC");
  const deluxeMaxLtvBps = m.getParameter("deluxeMaxLtvBps", 4000n); // 40%
  const deluxeLiquidationThresholdBps = m.getParameter("deluxeLiquidationThresholdBps", 7000n); // 70%
  const deluxeLiquidationPenaltyBps = m.getParameter("deluxeLiquidationPenaltyBps", 1000n); // 10%
  const deluxeBorrowRateBpsPerYear = m.getParameter("deluxeBorrowRateBpsPerYear", 800n); // 8%

  const createDeluxePoolTx = m.call(protocol.poolFactory, "createPool", [
    asset,
    deluxePoolName,
    deluxePoolSymbol,
    deluxeMaxLtvBps,
    deluxeLiquidationThresholdBps,
    deluxeLiquidationPenaltyBps,
    deluxeBorrowRateBpsPerYear,
  ], { id: "createDeluxePool", after: [createPremiumPoolTx] });

  const deluxePoolAddress = m.staticCall(protocol.poolFactory, "allPools", [1n], 0, {
    id: "getDeluxePoolAddress",
    after: [createDeluxePoolTx],
  });
  const deluxeLendingPool = m.contractAt("HoloFiLendingPool", deluxePoolAddress, {
    id: "DeluxeLendingPool",
  });
  m.call(deluxeLendingPool, "setLoanCore", [protocol.loanCore], { id: "setLoanCoreDeluxePool" });

  return {
    ...protocol,
    premiumLendingPool,
    deluxeLendingPool,
    lendingPool: premiumLendingPool,
    asset,
  };
});

export default DeployHoloFiLendingPool;
