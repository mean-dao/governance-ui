import { Wallet } from '@coral-xyz/anchor';
import {
  serializeInstructionToBase64,
  getGovernance,
  getRealm,
  getTokenOwnerRecordForRealm,
  getRealmConfigAddress,
  GoverningTokenType,
  GoverningTokenConfig,
  RpcContext,
  GovernanceAccountParser,
  RealmConfigAccount,
  ProgramAccount,
} from '@solana/spl-governance';
import type {
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
} from '@solana/web3.js';

import {
  InstructionDataWithHoldUpTime,
  createProposal as _createProposal,
} from 'actions/createProposal';
import { tryGetNftRegistrar } from 'VoteStakeRegistry/sdk/api';

import {
  vsrPluginsPks,
  nftPluginsPks,
  gatewayPluginsPks,
  pythPluginsPks,
} from '@hooks/useVotingPlugins';
import { getRegistrarPDA as getPluginRegistrarPDA } from '@utils/plugin/accounts';
import { getNfts } from '@utils/tokens';
import { NFTWithMeta, VotingClient } from '@utils/uiTypes/VotePlugin';

import { fetchPlugins } from './fetchPlugins';

interface Args {
  callbacks?: Parameters<typeof _createProposal>[11];
  cluster?: string;
  connection: Connection;
  councilTokenMintPublicKey?: PublicKey;
  communityTokenMintPublicKey?: PublicKey;
  governancePublicKey: PublicKey;
  governingTokenMintPublicKey: PublicKey;
  instructions: TransactionInstruction[];
  isDraft: boolean;
  programPublicKey: PublicKey;
  proposalDescription: string;
  proposalTitle: string;
  realmPublicKey: PublicKey;
  requestingUserPublicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
  signAllTransactions(transactions: Transaction[]): Promise<Transaction[]>;
}

export async function createProposal(args: Args) {
  const [
    governance,
    realm,
    tokenOwnerRecord,
    realmConfigPublicKey,
    // eslint-disable-next-line
    councilTokenOwnerRecord,
    // eslint-disable-next-line
    communityTokenOwnerRecord,
  ] = await Promise.all([
    getGovernance(args.connection, args.governancePublicKey),
    getRealm(args.connection, args.realmPublicKey),
    getTokenOwnerRecordForRealm(
      args.connection,
      args.programPublicKey,
      args.realmPublicKey,
      args.governingTokenMintPublicKey,
      args.requestingUserPublicKey,
    ).catch(() => undefined),
    getRealmConfigAddress(args.programPublicKey, args.realmPublicKey),
    args.councilTokenMintPublicKey
      ? getTokenOwnerRecordForRealm(
          args.connection,
          args.programPublicKey,
          args.realmPublicKey,
          args.councilTokenMintPublicKey,
          args.requestingUserPublicKey,
        ).catch(() => undefined)
      : undefined,
    args.communityTokenMintPublicKey
      ? getTokenOwnerRecordForRealm(
          args.connection,
          args.programPublicKey,
          args.realmPublicKey,
          args.communityTokenMintPublicKey,
          args.requestingUserPublicKey,
        ).catch(() => undefined)
      : undefined,
  ]);

  const userTOR =
    tokenOwnerRecord || communityTokenOwnerRecord || councilTokenOwnerRecord;

  if (!userTOR) {
    throw new Error('You do not have any voting power in this org');
  }

  const realmConfigAccountInfo = await args.connection.getAccountInfo(
    realmConfigPublicKey,
  );

  const realmConfig: ProgramAccount<RealmConfigAccount> = realmConfigAccountInfo
    ? GovernanceAccountParser(RealmConfigAccount)(
        realmConfigPublicKey,
        realmConfigAccountInfo,
      )
    : {
        pubkey: realmConfigPublicKey,
        owner: args.programPublicKey,
        account: new RealmConfigAccount({
          realm: args.realmPublicKey,
          communityTokenConfig: new GoverningTokenConfig({
            voterWeightAddin: undefined,
            maxVoterWeightAddin: undefined,
            tokenType: GoverningTokenType.Liquid,
            reserved: new Uint8Array(),
          }),
          councilTokenConfig: new GoverningTokenConfig({
            voterWeightAddin: undefined,
            maxVoterWeightAddin: undefined,
            tokenType: GoverningTokenType.Liquid,
            reserved: new Uint8Array(),
          }),
          reserved: new Uint8Array(),
        }),
      };

  const serializedInstructions = args.instructions.map(
    serializeInstructionToBase64,
  );

  const instructionData = serializedInstructions.map(
    (serializedInstruction) =>
      new InstructionDataWithHoldUpTime({
        governance,
        instruction: {
          governance,
          serializedInstruction,
          isValid: true,
        },
      }),
  );

  const proposalIndex = governance.account.proposalCount;
  const votingPlugins = await fetchPlugins(
    args.connection,
    args.programPublicKey,
    {
      publicKey: args.requestingUserPublicKey,
      signTransaction: args.signTransaction,
      signAllTransactions: args.signAllTransactions,
    } as Wallet,
    args.cluster === 'devnet',
  );

  const pluginPublicKey =
    realmConfig.account.communityTokenConfig.voterWeightAddin;
  let votingClient: VotingClient | undefined = undefined;
  let votingNfts: NFTWithMeta[] = [];

  if (pluginPublicKey) {
    const pluginPublicKeyStr = pluginPublicKey.toBase58();
    let client: VotingClient['client'] = undefined;
    // Check for plugins in a particular order. I'm not sure why, but I
    // borrowed this from /hooks/useVotingPlugins.ts
    if (vsrPluginsPks.includes(pluginPublicKeyStr) && votingPlugins.vsrClient) {
      client = votingPlugins.vsrClient;
    }

    if (nftPluginsPks.includes(pluginPublicKeyStr) && votingPlugins.nftClient) {
      client = votingPlugins.nftClient;

      if (client && args.communityTokenMintPublicKey) {
        const programId = client.program.programId;
        const registrarPDA = (
          await getPluginRegistrarPDA(
            args.realmPublicKey,
            args.communityTokenMintPublicKey,
            programId,
          )
        ).registrar;

        const registrar: any = await tryGetNftRegistrar(registrarPDA, client);
        const collections: string[] =
          registrar?.collectionConfigs.map((x: any) =>
            x.collection.toBase58(),
          ) || [];

        const nfts = await getNfts(args.requestingUserPublicKey, {
          cluster: args.cluster,
        } as any);

        votingNfts = nfts.filter(
          (nft) =>
            nft.collection &&
            nft.collection.mintAddress &&
            (nft.collection.verified ||
              typeof nft.collection.verified === 'undefined') &&
            collections.includes(nft.collection.mintAddress) &&
            nft.collection.creators?.filter((x) => x.verified).length > 0,
        );
      }
    }

    if (
      gatewayPluginsPks.includes(pluginPublicKeyStr) &&
      votingPlugins.gatewayClient
    ) {
      client = votingPlugins.gatewayClient;
    }

    if (
      pythPluginsPks.includes(pluginPublicKeyStr) &&
      votingPlugins.pythClient
    ) {
      client = votingPlugins.pythClient;
    }

    if (client) {
      votingClient = new VotingClient({
        realm,
        client,
        walletPk: args.requestingUserPublicKey,
      });

      votingClient._setCurrentVoterNfts(votingNfts);
    }
  }

  return _createProposal(
    {
      connection: args.connection,
      wallet: {
        publicKey: args.requestingUserPublicKey,
        signTransaction: args.signTransaction,
        signAllTransactions: args.signAllTransactions,
      },
      programId: args.programPublicKey,
      walletPubkey: args.requestingUserPublicKey,
    } as RpcContext,
    realm,
    args.governancePublicKey,
    userTOR,
    args.proposalTitle,
    args.proposalDescription,
    args.governingTokenMintPublicKey,
    proposalIndex,
    instructionData,
    args.isDraft,
    votingClient,
    args.callbacks,
  );
}
