import { expect } from "chai";
import { network } from "hardhat";
import DeployHoloFiProtocol from "../ignition/modules/DeployHoloFiProtocol.js";

const { ethers, ignition } = await network.create();

describe("Hardhat Ignition Deployment Verification Suite", function () {
  it("Should deploy full HoloFi protocol via Ignition and verify interconnectivity and role assignments", async function () {
    const [admin, oracleFeeder, minter, treasury] = await ethers.getSigners();

    const { acm, vaultCard, priceFeed, poolFactory, loanCore, dutchAuction } = await ignition.deploy(
      DeployHoloFiProtocol,
      {
        parameters: {
          DeployHoloFiProtocol: {
            oracleFeeder: oracleFeeder.address,
            minter: minter.address,
            treasury: treasury.address,
          },
        },
      }
    );

    const acmAddr = await acm.getAddress();
    const vaultCardAddr = await vaultCard.getAddress();
    const priceFeedAddr = await priceFeed.getAddress();
    const poolFactoryAddr = await poolFactory.getAddress();
    const loanCoreAddr = await loanCore.getAddress();
    const dutchAuctionAddr = await dutchAuction.getAddress();

    // Verify non-zero contract addresses
    expect(acmAddr).to.not.equal(ethers.ZeroAddress);
    expect(vaultCardAddr).to.not.equal(ethers.ZeroAddress);
    expect(priceFeedAddr).to.not.equal(ethers.ZeroAddress);
    expect(poolFactoryAddr).to.not.equal(ethers.ZeroAddress);
    expect(loanCoreAddr).to.not.equal(ethers.ZeroAddress);
    expect(dutchAuctionAddr).to.not.equal(ethers.ZeroAddress);

    // Verify LoanCore contract references
    expect(await loanCore.acm()).to.equal(acmAddr);
    expect(await loanCore.vaultCard()).to.equal(vaultCardAddr);
    expect(await loanCore.poolFactory()).to.equal(poolFactoryAddr);
    expect(await loanCore.priceFeed()).to.equal(priceFeedAddr);
    expect(await loanCore.dutchAuction()).to.equal(dutchAuctionAddr);

    // Verify DutchAuction contract references
    expect(await dutchAuction.acm()).to.equal(acmAddr);
    expect(await dutchAuction.loanCore()).to.equal(loanCoreAddr);
    expect(await dutchAuction.poolFactory()).to.equal(poolFactoryAddr);
    expect(await dutchAuction.treasury()).to.equal(treasury.address);

    // Verify role authorizations via ACM
    const ORACLE_ROLE = await acm.ORACLE_ROLE();
    const MINTER_ROLE = await acm.MINTER_ROLE();

    expect(await acm.hasRole(ORACLE_ROLE, oracleFeeder.address)).to.be.true;
    expect(await acm.hasRole(MINTER_ROLE, minter.address)).to.be.true;
  });
});
