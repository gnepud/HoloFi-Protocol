import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";
import DeployHoloFiLendingPoolWithMock from "./DeployHoloFiLendingPoolWithMock.js";

const DeployHoloFiFullProtocol = buildModule("DeployHoloFiFullProtocol", (m) => {
  const protocol = m.useModule(DeployHoloFiProtocol);
  const poolModule = m.useModule(DeployHoloFiLendingPoolWithMock);

  return {
    ...protocol,
    premiumLendingPool: poolModule.premiumLendingPool,
    deluxeLendingPool: poolModule.deluxeLendingPool,
    lendingPool: poolModule.lendingPool,
    mockAsset: poolModule.mockAsset,
  };
});

export default DeployHoloFiFullProtocol;
