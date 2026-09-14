import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { api, setToken, getToken } from "../lib/api"
import { getWallet } from "../lib/wallet"
import { signEvmMessage, signSolanaMessage, signTronMessage } from "../lib/walletconnect"
import { connectEvmProvider, signEvmProviderMessage } from "../lib/evmProvider"

const AuthContext = createContext(null)

const errorOf = (res, fallback) => {
  if (res.json && res.json.error) return res.json.error
  if (res.json && res.json.message) return res.json.message
  return fallback
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [initializing, setInitializing] = useState(Boolean(getToken()))
  const [walletConnected, setWalletConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      if (!getToken()) return
      const res = await api.me()
      if (cancelled) return
      if (res.status === 200 && res.json.success) setUser(res.json.user)
      else setToken(null)
      setInitializing(false)
    }
    restore()
    return () => {
      cancelled = true
    }
  }, [])

  const applyAuth = useCallback(({ token, user: nextUser }) => {
    setToken(token)
    setUser(nextUser)
  }, [])

  const register = useCallback(
    async (creds) => {
      const res = await api.register(creds)
      if (res.status === 201 && res.json.success) applyAuth(res.json)
      return res
    },
    [applyAuth]
  )

  const login = useCallback(
    async (loginName, password) => {
      const res = await api.login(loginName, password)
      if (res.status === 200 && res.json.success) applyAuth(res.json)
      return res
    },
    [applyAuth]
  )

  // Tron (Trust Wallet browser extension) challenge flow.
  const signChallenge = useCallback(async (address) => {
    const wallet = getWallet()
    const nonceRes = await api.walletNonce(address)
    if (nonceRes.status !== 200 || !nonceRes.json.message) {
      await wallet.disconnect()
      throw new Error(errorOf(nonceRes, "Could not get a signing challenge."))
    }
    const message = nonceRes.json.message
    const signature = await wallet.signMessage(message)
    return { wallet, message, signature }
  }, [])

  const walletLogin = useCallback(async () => {
    const wallet = getWallet()
    const address = await wallet.connect()
    const { message, signature } = await signChallenge(address)
    const res = await api.walletVerify({ address, message, signature })
    if (res.status === 200 && res.json.success) {
      applyAuth(res.json)
      setWalletConnected(true)
    } else {
      await wallet.disconnect()
    }
    return res
  }, [applyAuth, signChallenge])

  // EVM (WalletConnect/Trust Wallet mobile) variants. The caller handles the
  // pairing + QR scan and passes the approved session; these finish the
  // challenge/response against the backend and apply the auth state.
  const evmSignChallenge = useCallback(async (address) => {
    const nonceRes = await api.walletEvmNonce(address)
    if (nonceRes.status !== 200 || !nonceRes.json.message) {
      throw new Error(errorOf(nonceRes, "Could not get a signing challenge."))
    }
    return nonceRes.json.message
  }, [])

  const evmWalletLogin = useCallback(
    async ({ client, session, address }) => {
      const message = await evmSignChallenge(address)
      const signature = await signEvmMessage(client, session, message, address)
      const res = await api.walletEvmVerify({ address, message, signature })
      if (res.status === 200 && res.json.success) {
        applyAuth(res.json)
        setWalletConnected(true)
      }
      return res
    },
    [applyAuth, evmSignChallenge]
  )

  const evmLinkWallet = useCallback(
    async ({ client, session, address }) => {
      const message = await evmSignChallenge(address)
      const signature = await signEvmMessage(client, session, message, address)
      const res = await api.linkWalletEvm({ address, message, signature })
      if (res.status === 200 && res.json.success) {
        setWalletConnected(true)
        const me = await api.me()
        if (me.status === 200 && me.json.success) setUser(me.json.user)
      }
      return res
    },
    [evmSignChallenge]
  )

  // Tron via WalletConnect (session granted by the same QR scan as EVM —
  // WalletConnect has supported the tron namespace since Jan 2026, and Trust
  // Wallet grants it). Signs the challenge with tron_signMessage over the
  // session topic; the backend verifies with verifyMessageV2.
  const tronWcSignChallenge = useCallback(async (client, session, address) => {
    const nonceRes = await api.walletNonce(address)
    if (nonceRes.status !== 200 || !nonceRes.json.message) {
      throw new Error(errorOf(nonceRes, "Could not get a signing challenge."))
    }
    const message = nonceRes.json.message
    const signature = await signTronMessage(client, session, message, address)
    return { message, signature }
  }, [])

  const tronWcLogin = useCallback(
    async ({ client, session, address }) => {
      const { message, signature } = await tronWcSignChallenge(client, session, address)
      const res = await api.walletVerify({ address, message, signature })
      if (res.status === 200 && res.json.success) {
        applyAuth(res.json)
        setWalletConnected(true)
      }
      return res
    },
    [applyAuth, tronWcSignChallenge]
  )

  const tronWcLink = useCallback(
    async ({ client, session, address }) => {
      const { message, signature } = await tronWcSignChallenge(client, session, address)
      const res = await api.linkWallet({ address, message, signature })
      if (res.status === 200 && res.json.success) {
        setWalletConnected(true)
        const me = await api.me()
        if (me.status === 200 && me.json.success) setUser(me.json.user)
      }
      return res
    },
    [tronWcSignChallenge]
  )

  // Solana via WalletConnect (same QR scan as EVM + Tron — solana is a third
  // OPTIONAL namespace). Signs the challenge with solana_signMessage (ed25519
  // detached) over the session topic; the backend verifies with Node crypto.
  const solWcSignChallenge = useCallback(async (client, session, address) => {
    const nonceRes = await api.walletSolNonce(address)
    if (nonceRes.status !== 200 || !nonceRes.json.message) {
      throw new Error(errorOf(nonceRes, "Could not get a signing challenge."))
    }
    const message = nonceRes.json.message
    const signature = await signSolanaMessage(client, session, message, address)
    return { message, signature }
  }, [])

  const solanaWcLogin = useCallback(
    async ({ client, session, address }) => {
      const { message, signature } = await solWcSignChallenge(client, session, address)
      const res = await api.walletSolVerify({ address, message, signature })
      if (res.status === 200 && res.json.success) {
        applyAuth(res.json)
        setWalletConnected(true)
      }
      return res
    },
    [applyAuth, solWcSignChallenge]
  )

  const solanaWcLink = useCallback(
    async ({ client, session, address }) => {
      const { message, signature } = await solWcSignChallenge(client, session, address)
      const res = await api.linkWalletSol({ address, message, signature })
      if (res.status === 200 && res.json.success) {
        setWalletConnected(true)
        const me = await api.me()
        if (me.status === 200 && me.json.success) setUser(me.json.user)
      }
      return res
    },
    [solWcSignChallenge]
  )

  // EVM via an EIP-1193 injected provider (Trust Wallet DApp browser). The
  // caller passes the detected provider; this connects, signs the challenge
  // with personal_sign and finishes the same backend flow as WalletConnect.
  const evmProviderLogin = useCallback(
    async (provider) => {
      const address = await connectEvmProvider(provider)
      const message = await evmSignChallenge(address)
      const signature = await signEvmProviderMessage(provider, message, address)
      const res = await api.walletEvmVerify({ address, message, signature })
      if (res.status === 200 && res.json.success) {
        applyAuth(res.json)
        setWalletConnected(true)
      }
      return res
    },
    [applyAuth, evmSignChallenge]
  )

  const evmProviderLink = useCallback(
    async (provider) => {
      const address = await connectEvmProvider(provider)
      const message = await evmSignChallenge(address)
      const signature = await signEvmProviderMessage(provider, message, address)
      const res = await api.linkWalletEvm({ address, message, signature })
      if (res.status === 200 && res.json.success) {
        setWalletConnected(true)
        const me = await api.me()
        if (me.status === 200 && me.json.success) setUser(me.json.user)
      }
      return res
    },
    [evmSignChallenge]
  )

  const linkWallet = useCallback(async () => {
    const wallet = getWallet()
    const address = await wallet.connect()
    const { message, signature } = await signChallenge(address)
    const res = await api.linkWallet({ address, message, signature })
    if (res.status === 200 && res.json.success) {
      setWalletConnected(true)
      const me = await api.me()
      if (me.status === 200 && me.json.success) setUser(me.json.user)
    } else {
      await wallet.disconnect()
    }
    return res
  }, [signChallenge])

  const unlinkWallet = useCallback(async () => {
    const res = await api.unlinkWallet()
    if (res.status === 200 && res.json.success) {
      setWalletConnected(false)
      await getWallet().disconnect()
      const me = await api.me()
      if (me.status === 200 && me.json.success) setUser(me.json.user)
    }
    return res
  }, [])

  const evmUnlinkWallet = useCallback(async () => {
    const res = await api.unlinkWalletEvm()
    if (res.status === 200 && res.json.success) {
      setWalletConnected(false)
      const me = await api.me()
      if (me.status === 200 && me.json.success) setUser(me.json.user)
    }
    return res
  }, [])

  const solUnlinkWallet = useCallback(async () => {
    const res = await api.unlinkWalletSol()
    if (res.status === 200 && res.json.success) {
      setWalletConnected(false)
      const me = await api.me()
      if (me.status === 200 && me.json.success) setUser(me.json.user)
    }
    return res
  }, [])

  const logout = useCallback(async () => {
    await getWallet().disconnect()
    setWalletConnected(false)
    setToken(null)
    setUser(null)
  }, [])

  // Re-fetch the current user from the backend. Used when a payment/balance
  // call reports the Tron wallet as not linked (TRON_WALLET_NOT_LINKED) — the
  // client may hold a stale `user` object with a walletAddress that the DB no
  // longer has, so refresh it to clear the phantom address.
  const refreshUser = useCallback(async () => {
    const me = await api.me()
    if (me.status === 200 && me.json.success) {
      setUser(me.json.user)
      return me.json.user
    }
    return null
  }, [])

  const value = useMemo(
    () => ({
      user,
      initializing,
      walletConnected,
      register,
      login,
      walletLogin,
      evmWalletLogin,
      evmProviderLogin,
      evmLinkWallet,
      evmProviderLink,
      tronWcLogin,
      tronWcLink,
      solanaWcLogin,
      solanaWcLink,
      linkWallet,
      unlinkWallet,
      evmUnlinkWallet,
      solUnlinkWallet,
      logout,
      refreshUser,
    }),
    [user, walletConnected, initializing, register, login, walletLogin, evmWalletLogin, evmProviderLogin, evmLinkWallet, evmProviderLink, tronWcLogin, tronWcLink, solanaWcLogin, solanaWcLink, linkWallet, unlinkWallet, evmUnlinkWallet, solUnlinkWallet, logout, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)