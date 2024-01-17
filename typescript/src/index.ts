import * as algokit from '@algorandfoundation/algokit-utils';
import { StorageOrderClient } from './StorageOrderClient'
import algosdk from 'algosdk';
import nacl from 'tweetnacl'

async function getAccount(algod: algosdk.Algodv2) {
    const kmd = algokit.getAlgoKmdClient({
        server: 'http://localhost',
        port: 4002,
        token: 'a'.repeat(64),
    });

    // Use algokit to create a KMD account named 'deployer'
    const account = await algokit.getOrCreateKmdWalletAccount({
        name: 'uploader',
        // set fundWith to 0 so algokit doesn't try to fund the account from another kmd account
        fundWith: algokit.microAlgos(0),
    }, algod, kmd);

    const { amount } = await algod.accountInformation(account.addr).do();

    if (amount === 0) {
        throw Error(`Account ${account.addr} has no funds. Please fund it and try again.`);
    }

    return account
}

async function getAppClient(algod: algosdk.Algodv2, sender: algosdk.Account, network: 'testnet' | 'mainnet') {


    return new StorageOrderClient(
        {
            sender,
            resolveBy: 'id',
            id: network === 'testnet' ? 507867511 : 1275319623,
        },
        algod,
    );
}

async function getPrice(algod: algosdk.Algodv2, appClient: StorageOrderClient, size: number) {
    const result = await (await appClient.compose().getPrice({ size, is_permanent: false }).atc()).simulate(algod)

    return result.methodResults[0].returnValue?.valueOf() as number
}

function getAuthHeader(account: algosdk.Account) {
    const sk32 = account.sk.slice(0, 32)
    const signingKey = nacl.sign.keyPair.fromSeed(sk32)

    const signature = nacl.sign(Buffer.from(account.addr), signingKey.secretKey)
    const sigHex = Buffer.from(signature).toString('hex').slice(0, 128)
    const authStr = `sub-${account.addr}:0x${sigHex}`

    return Buffer.from(authStr).toString('base64')
}

async function uploadToIPFS(account: algosdk.Account) {
    const headers = { "Authorization": `Basic ${getAuthHeader(account)}`, "Content-Disposition": `form-data; name="upload_file"; filename="README.md"` }

    const response = await fetch('https://gw-seattle.crustcloud.io:443/api/v0/add', {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'multipart/form-data; boundary=ae36a08c478c4b29b6491c99272fe367',
        },
        body: '--ae36a08c478c4b29b6491c99272fe367\nContent-Disposition: form-data; name="upload_file"; filename="README.md"\n\n# crust-examples\n\nTo install dependencies:\n\n```bash\nbun install\n```\n\nTo run:\n\n```bash\nbun run index.ts\n```\n\nThis project was created using `bun init` in bun v1.0.0. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.\n\n--ae36a08c478c4b29b6491c99272fe367--\n'
    });

    const json: any = await response.json()

    return { cid: json.Hash, size: Number(json.Size) }
}

async function getOrderNode(algod: algosdk.Algodv2, appClient: StorageOrderClient) {
    return (await (await appClient.compose().getRandomOrderNode({}, { boxes: [new Uint8Array(Buffer.from('nodes'))] }).atc()).simulate(algod)).methodResults[0].returnValue?.valueOf() as string
}

async function placeOrder(algod: algosdk.Algodv2, appClient: StorageOrderClient, account: algosdk.Account, cid: string, size: number, price: number) {

    const merchant = await getOrderNode(algod, appClient)
    const seed = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: account.addr,
        to: (await appClient.appClient.getAppReference()).appAddress,
        amount: price,
        suggestedParams: await algod.getTransactionParams().do(),
    });

    appClient.placeOrder({ seed, cid, size, is_permanent: false, merchant })
}

async function main(network: 'testnet' | 'mainnet') {
    const algod = algokit.getAlgoClient(algokit.getAlgoNodeConfig(network, 'algod'));
    const account = await getAccount(algod)

    const appClient = await getAppClient(algod, account, network)

    const { size, cid } = await uploadToIPFS(account)

    const price = await getPrice(algod, appClient, size)

    await placeOrder(algod, appClient, account, cid, size, price)
}

main('testnet')