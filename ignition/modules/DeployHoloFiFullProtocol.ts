import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";
import DeployHoloFiLendingPool from "./DeployHoloFiLendingPool.js";

const DeployHoloFiFullProtocol = buildModule("DeployHoloFiFullProtocol", (m) => {
  const protocol = m.useModule(DeployHoloFiProtocol);
  const { lendingPool, mockAsset, assetAddress } = m.useModule(DeployHoloFiLendingPool);

  return {
    ...protocol,
    lendingPool,
    mockAsset,
    assetAddress,
  };
});

export default DeployHoloFiFullProtocol;
