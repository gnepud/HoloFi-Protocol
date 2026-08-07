import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const DeployHoloFiProtocol = buildModule("DeployHoloFiProtocol", (m) => {
  const initialAdmin = m.getAccount(0);
  const oracleFeeder = m.getParameter("oracleFeeder", initialAdmin);
  const minter = m.getParameter("minter", initialAdmin);
  const treasury = m.getParameter("treasury", initialAdmin);

  // 1. AccessControlManager
  const acm = m.contract("AccessControlManager", [initialAdmin]);

  // 2. HoloFiVaultCard
  const vaultCard = m.contract("HoloFiVaultCard", [
    "HoloFi Vaulted TCG Cards",
    "HFC",
    acm,
  ]);

  // 3. HoloFiCardPriceFeed
  const priceFeed = m.contract("HoloFiCardPriceFeed", [acm]);

  // 4. HoloFiLendingPoolFactory
  const poolFactory = m.contract("HoloFiLendingPoolFactory", [acm]);

  // 5. HoloFiVaultLoanCore
  const loanCore = m.contract("HoloFiVaultLoanCore", [
    acm,
    vaultCard,
    poolFactory,
    priceFeed,
  ]);

  // 6. HoloFiDutchAuction
  const dutchAuction = m.contract("HoloFiDutchAuction", [
    acm,
    loanCore,
    poolFactory,
  ]);

  // Interconnectivity Wire-up Calls
  m.call(loanCore, "setDutchAuction", [dutchAuction]);
  m.call(dutchAuction, "setTreasury", [treasury]);

  // Role Assignments via ACM
  const ORACLE_ROLE = m.staticCall(acm, "ORACLE_ROLE");
  const MINTER_ROLE = m.staticCall(acm, "MINTER_ROLE");

  m.call(acm, "grantRole", [ORACLE_ROLE, oracleFeeder], { id: "grantRole_oracleFeeder" });
  m.call(acm, "grantRole", [MINTER_ROLE, minter], { id: "grantRole_minter" });

  return {
    acm,
    vaultCard,
    priceFeed,
    poolFactory,
    loanCore,
    dutchAuction,
  };
});

export default DeployHoloFiProtocol;
