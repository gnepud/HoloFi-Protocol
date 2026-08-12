import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";

const DeployHoloFiLendingPool = buildModule("DeployHoloFiLendingPool", (m) => {
  const protocol = m.useModule(DeployHoloFiProtocol);

  const existingAssetAddress = m.getParameter("existingAssetAddress");
  const poolName = m.getParameter("poolName", "Pool EURC");
  const poolSymbol = m.getParameter("poolSymbol", "pEURC");

  const asset = m.contractAt("MockERC20", existingAssetAddress);

  const createPoolTx = m.call(protocol.poolFactory, "createPool", [
    asset,
    poolName,
    poolSymbol,
  ]);

  const poolAddress = m.staticCall(protocol.poolFactory, "getPool", [asset], 0, {
    after: [createPoolTx],
  });

  const lendingPool = m.contractAt("HoloFiLendingPool", poolAddress);

  m.call(lendingPool, "setLoanCore", [protocol.loanCore]);

  return {
    ...protocol,
    lendingPool,
    asset,
  };
});

export default DeployHoloFiLendingPool;
