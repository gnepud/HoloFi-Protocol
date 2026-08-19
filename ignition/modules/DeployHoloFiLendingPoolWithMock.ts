import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";

const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

const DeployHoloFiLendingPoolWithMock = buildModule("DeployHoloFiLendingPoolWithMock", (m) => {
  const { poolFactory, loanCore, acm, vaultCard, priceFeed, dutchAuction } = m.useModule(DeployHoloFiProtocol);

  const totalMockMintAmount = m.getParameter("mockMintAmount", 10_000_000_000_000n); // 10,000,000 EURC (6 decimals)
  const depositPerPool = m.getParameter("depositPerPool", 5_000_000_000_000n); // 5,000,000 EURC per pool

  // Pool 1: Premium Pool EURC (pEURC)
  const premiumPoolName = m.getParameter("premiumPoolName", "Premium Pool EURC");
  const premiumPoolSymbol = m.getParameter("premiumPoolSymbol", "pEURC");
  const premiumMaxLtvBps = m.getParameter("premiumMaxLtvBps", 5000n); // 50%
  const premiumLiquidationThresholdBps = m.getParameter("premiumLiquidationThresholdBps", 7000n); // 70%
  const premiumLiquidationPenaltyBps = m.getParameter("premiumLiquidationPenaltyBps", 1000n); // 10%
  const premiumBorrowRateBpsPerYear = m.getParameter("premiumBorrowRateBpsPerYear", 500n); // 5%

  // Pool 2: Deluxe Pool EURC (dEURC)
  const deluxePoolName = m.getParameter("deluxePoolName", "Deluxe Pool EURC");
  const deluxePoolSymbol = m.getParameter("deluxePoolSymbol", "dEURC");
  const deluxeMaxLtvBps = m.getParameter("deluxeMaxLtvBps", 4000n); // 40%
  const deluxeLiquidationThresholdBps = m.getParameter("deluxeLiquidationThresholdBps", 7000n); // 70%
  const deluxeLiquidationPenaltyBps = m.getParameter("deluxeLiquidationPenaltyBps", 1000n); // 10%
  const deluxeBorrowRateBpsPerYear = m.getParameter("deluxeBorrowRateBpsPerYear", 800n); // 8%

  const mockAsset = m.contract("MockERC20", ["Euro Coin", "EURC", 6]);

  // Create Premium Pool (pEURC)
  const createPremiumPoolTx = m.call(poolFactory, "createPool", [
    mockAsset,
    premiumPoolName,
    premiumPoolSymbol,
    premiumMaxLtvBps,
    premiumLiquidationThresholdBps,
    premiumLiquidationPenaltyBps,
    premiumBorrowRateBpsPerYear,
  ], { id: "createPremiumPool" });

  const premiumPoolAddress = m.staticCall(poolFactory, "allPools", [0n], 0, {
    id: "getPremiumPoolAddressWithMock",
    after: [createPremiumPoolTx],
  });
  const premiumLendingPool = m.contractAt("HoloFiLendingPool", premiumPoolAddress, {
    id: "PremiumLendingPool",
  });
  m.call(premiumLendingPool, "setLoanCore", [loanCore], { id: "setLoanCorePremiumPool" });

  // Policy: Exact PSA 10 for Premium Pool
  const premiumRequiredGrader = m.getParameter("premiumRequiredGrader", "PSA");
  const premiumMinGrade = m.getParameter("premiumMinGrade", 10n);
  const premiumMaxGrade = m.getParameter("premiumMaxGrade", 10n);
  const premiumPoolPolicy = m.contract("GradeEligibilityPolicy", [
    acm,
    premiumRequiredGrader,
    premiumMinGrade,
    premiumMaxGrade,
  ], { id: "PremiumPoolGradeEligibilityPolicy" });
  m.call(premiumLendingPool, "setEligibilityPolicy", [premiumPoolPolicy], { id: "setEligibilityPolicyPremiumPool" });

  // Create Deluxe Pool (dEURC)
  const createDeluxePoolTx = m.call(poolFactory, "createPool", [
    mockAsset,
    deluxePoolName,
    deluxePoolSymbol,
    deluxeMaxLtvBps,
    deluxeLiquidationThresholdBps,
    deluxeLiquidationPenaltyBps,
    deluxeBorrowRateBpsPerYear,
  ], { id: "createDeluxePool", after: [createPremiumPoolTx] });

  const deluxePoolAddress = m.staticCall(poolFactory, "allPools", [1n], 0, {
    id: "getDeluxePoolAddressWithMock",
    after: [createDeluxePoolTx],
  });
  const deluxeLendingPool = m.contractAt("HoloFiLendingPool", deluxePoolAddress, {
    id: "DeluxeLendingPool",
  });
  m.call(deluxeLendingPool, "setLoanCore", [loanCore], { id: "setLoanCoreDeluxePool" });

  // Policy: Exact PSA 9 for Deluxe Pool
  const deluxeRequiredGrader = m.getParameter("deluxeRequiredGrader", "PSA");
  const deluxeMinGrade = m.getParameter("deluxeMinGrade", 9n);
  const deluxeMaxGrade = m.getParameter("deluxeMaxGrade", 9n);
  const deluxePoolPolicy = m.contract("GradeEligibilityPolicy", [
    acm,
    deluxeRequiredGrader,
    deluxeMinGrade,
    deluxeMaxGrade,
  ], { id: "DeluxePoolGradeEligibilityPolicy" });
  m.call(deluxeLendingPool, "setEligibilityPolicy", [deluxePoolPolicy], { id: "setEligibilityPolicyDeluxePool" });

  const deployer = m.getAccount(0);

  // Mint mock tokens to deployer (10,000,000 EURC)
  const mintToDeployerTx = m.call(mockAsset, "mint", [deployer, totalMockMintAmount], {
    id: "mintMockInitialToDeployer",
  });

  // Approve & Deposit 5,000,000 EURC to Premium Pool (pEURC)
  const approvePremiumPoolTx = m.call(mockAsset, "approve", [premiumLendingPool, depositPerPool], {
    id: "approvePremiumLendingPoolDeposit",
    after: [mintToDeployerTx],
  });
  m.call(premiumLendingPool, "deposit", [depositPerPool, DEAD_ADDRESS], {
    id: "depositSeedLiquidityToPremiumPool",
    after: [approvePremiumPoolTx],
  });

  // Approve & Deposit 5,000,000 EURC to Deluxe Pool (dEURC)
  const approveDeluxePoolTx = m.call(mockAsset, "approve", [deluxeLendingPool, depositPerPool], {
    id: "approveDeluxeLendingPoolDeposit",
    after: [mintToDeployerTx],
  });
  m.call(deluxeLendingPool, "deposit", [depositPerPool, DEAD_ADDRESS], {
    id: "depositSeedLiquidityToDeluxePool",
    after: [approveDeluxePoolTx],
  });

  return {
    acm,
    vaultCard,
    priceFeed,
    poolFactory,
    loanCore,
    dutchAuction,
    premiumLendingPool,
    deluxeLendingPool,
    premiumPoolPolicy,
    deluxePoolPolicy,
    lendingPool: premiumLendingPool,
    mockAsset,
    assetAddress: mockAsset,
  };
});

export default DeployHoloFiLendingPoolWithMock;
