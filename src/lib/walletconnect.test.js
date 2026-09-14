import { signTronTransaction, TRON_CHAIN } from "./walletconnect"

jest.mock("@walletconnect/sign-client", () => ({ __esModule: true, default: {} }))

const address = "TTestAccount"
const transaction = { txID: "test", raw_data: { contract: [] }, raw_data_hex: "00" }
const makeSession = (version) => ({
  topic: "test-topic",
  namespaces: {
    tron: { methods: ["tron_signTransaction"], accounts: [`${TRON_CHAIN}:${address}`] },
  },
  ...(version ? { sessionProperties: { tron_method_version: version } } : {}),
})

test.each([undefined, "v1"])("signs using the negotiated %s format", async (version) => {
  const signed = { ...transaction, signature: ["test-signature"] }
  const client = { request: jest.fn().mockResolvedValue(signed) }
  await expect(signTronTransaction(client, makeSession(version), transaction, address)).resolves.toBe(signed)
  expect(client.request).toHaveBeenCalledTimes(1)
  expect(client.request).toHaveBeenCalledWith({
    topic: "test-topic",
    chainId: TRON_CHAIN,
    request: {
      method: "tron_signTransaction",
      params: { address, transaction: version === "v1" ? transaction : { transaction } },
    },
  })
})

test("does not request signing without the method or matching mainnet account", async () => {
  const client = { request: jest.fn() }
  const session = makeSession()
  session.namespaces.tron.methods = []
  await expect(signTronTransaction(client, session, transaction, address)).rejects.toThrow("does not support")
  await expect(signTronTransaction(client, makeSession(), transaction, "TDifferentAccount")).rejects.toThrow("has not approved")
  expect(client.request).not.toHaveBeenCalled()
})

test("rejects unsigned results and does not retry wallet rejections", async () => {
  const client = { request: jest.fn().mockResolvedValue(transaction) }
  await expect(signTronTransaction(client, makeSession(), transaction, address)).rejects.toThrow("without a signature")
  client.request.mockReset().mockRejectedValue(new Error("Unknown method(s) requested"))
  await expect(signTronTransaction(client, makeSession(), transaction, address)).rejects.toThrow("Unknown method")
  expect(client.request).toHaveBeenCalledTimes(1)
})
