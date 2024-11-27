import { Network as VeridaNetwork, IContext, ContextSession, IAccount } from '@verida/types'
import { Client } from "@verida/client-ts"
import { AutoAccount } from '@verida/account-node'

const VERIDA_NETWORK = VeridaNetwork.MYRTLE

export const VERIDA_DID_REGEXP =
  /did:vda:(devnet|mainnet|testnet):0x[0-9a-fA-F]{40}/;

const VAULT_CONTEXT_NAME = 'Verida: Vault'
const DID_CLIENT_CONFIG = {
    "callType": "web3",
    "network": "myrtle",
    "web3Config": {
        "callType": "web3",
        "privateKey": "1eb6776c1626795d2e33e8b063cc7e639f50a45e79cded84d978e3a2524af1dc"
    }
}
const SBT_CREDENTIAL_SCHEMA = 'https://common.schemas.verida.io/token/sbt/credential/v0.1.0/schema.json'
const NETWORK_CONNECTION_CACHE_EXPIRY = 60*3 // 3 mins

export {
    DID_CLIENT_CONFIG,
    SBT_CREDENTIAL_SCHEMA
}

export interface NetworkConnectionCache {
    requestIds: string[],
    currentPromise?: Promise<void>,
    networkConnection?: NetworkConnection
    lastTouch: Date
}

export interface NetworkConnection {
    network: Client,
    context: IContext,
    account: IAccount,
    did: string
}

export class Utils {
    protected static networkCache: Record<string, NetworkConnectionCache> = {}

    /**
     * Get a network, context and account instance
     *
     * @returns
     * Get a network connection from a private key
     *
     * @param privateKey
     * @param requestId
     * @returns
     */
    public static async getNetworkConnectionFromPrivateKey(privateKey: string, requestId: string = 'none'): Promise<NetworkConnection> {
        const account = new AutoAccount({
            privateKey,
            network: VERIDA_NETWORK,
            // @ts-ignore
            didClientConfig: DID_CLIENT_CONFIG
        })

        return await Utils.getNetworkConnection(account, requestId)
    }

    /**
     * Get a network, context and account instance
     *
     * @returns
     */
    private static async getNetworkConnection(account: IAccount, requestId: string = 'none'): Promise<NetworkConnection> {
        const did = await account.did()

        // If we have a promise for changing state, wait for it to complete
        if (Utils.networkCache[did] && Utils.networkCache[did].currentPromise) {
            await Utils.networkCache[did].currentPromise
        }

        if (Utils.networkCache[did]) {
            Utils.networkCache[did].requestIds.push(requestId)
            Utils.touchNetworkCache(did)

            Utils.gcNetworkCache()
            return Utils.networkCache[did].networkConnection!
        }

        // If cache is shutting down, wait until it's shut down
        // if (Utils.networkCache[did] && Utils.networkCache[did].shutting) {
        //     console.log('awaiting shut down promise', requestId)
        //     await Utils.networkCache[did].shuttingPromise
        // }
        Utils.networkCache[did] = {
            requestIds: [requestId],
            lastTouch: new Date()
        }

        const network = new Client({
            network: VERIDA_NETWORK
        })

        Utils.networkCache[did].currentPromise = new Promise(async (resolve, reject) => {
            try {
                await network.connect(account)
                const context = await network.openContext(VAULT_CONTEXT_NAME) as IContext

                const networkConnection: NetworkConnection = {
                    network,
                    context,
                    account,
                    did
                }

                Utils.networkCache[did] = {
                    requestIds: [requestId],
                    lastTouch: new Date(),
                    networkConnection
                }

                resolve()
            } catch (err: any) {
                if (err.message.match('Unable to locate')) {
                    reject(new Error(`Invalid credentials or account is not registered to this network: ${VERIDA_NETWORK.toString()}`))
                } else {
                    delete Utils.networkCache[did]
                    reject(err)
                }
            }
        })

        await Utils.networkCache[did].currentPromise
        return Utils.networkCache[did].networkConnection!
    }

    public static async touchNetworkCache(did: string) {
        if (Utils.networkCache[did]) {
            Utils.networkCache[did].lastTouch = new Date()
        }
    }

    public static async gcNetworkCache() {
        // console.log("gcNetworkCache()")
        for (const did in Utils.networkCache) {
            const cache = Utils.networkCache[did]
            const duration = ((new Date()).getTime() - cache.lastTouch.getTime())/1000
            // console.log("gcNetworkCache()", duration)
            if (duration > NETWORK_CONNECTION_CACHE_EXPIRY) {
                // Check network connection exists (may not because connection may have failed)
                if (Utils.networkCache[did].networkConnection) {
                    await Utils.networkCache[did].networkConnection.context.close()
                }

                delete Utils.networkCache[did]
            }
        }
    }

    public static async closeConnection(did: string, requestId: string = 'none'): Promise<void> {
        Utils.networkCache[did].requestIds = Utils.networkCache[did].requestIds.filter(id => id !== requestId)

        if (Utils.networkCache[did].currentPromise) {
            await Utils.networkCache[did].currentPromise
        }

        if (Utils.networkCache[did].requestIds.length == 0 && !Utils.networkCache[did].currentPromise) {
            Utils.networkCache[did].currentPromise = new Promise((resolve, reject) => {
                Utils.networkCache[did].networkConnection!.context.close()
                delete Utils.networkCache[did]
                resolve()
            })
        }
    }

    public static async getDidFromKey(privateKey: string): Promise<string> {
        const network = VERIDA_NETWORK
      // Initialize Account
      const account = new AutoAccount({
        privateKey,
        network,
        // @ts-ignore
        didClientConfig: DID_CLIENT_CONFIG
      })

      const did = await account.did()
      return did
    }

    public static nowTimestamp() {
        return (new Date()).toISOString()
    }
}
