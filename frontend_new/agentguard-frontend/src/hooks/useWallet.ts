import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'

const ARB_SEPOLIA_CHAIN_ID = '0x66eee' // 421614 decimal

export interface WalletState {
  address: string | null
  chainId: string | null
  isCorrectChain: boolean
  isConnecting: boolean
  error: string | null
  connect: () => Promise<void>
  getSigner: () => null
}

export function useWallet(): WalletState {
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCorrectChain = chainId === ARB_SEPOLIA_CHAIN_ID

  // Re-hydrate on mount if already connected
  useEffect(() => {
    const eth = (window as any).ethereum
    if (!eth) return

    eth.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts[0]) setAddress(accounts[0])
    })
    eth.request({ method: 'eth_chainId' }).then(setChainId)

    const onAccounts = (accounts: string[]) => setAddress(accounts[0] ?? null)
    const onChain = (id: string) => setChainId(id)

    eth.on('accountsChanged', onAccounts)
    eth.on('chainChanged', onChain)
    return () => {
      eth.removeListener('accountsChanged', onAccounts)
      eth.removeListener('chainChanged', onChain)
    }
  }, [])

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum
    if (!eth) { setError('No wallet detected. Install MetaMask.'); return }
    setIsConnecting(true)
    setError(null)
    try {
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
      setAddress(accounts[0] ?? null)
      const id: string = await eth.request({ method: 'eth_chainId' })
      setChainId(id)
      // Prompt chain switch if wrong network
      if (id !== ARB_SEPOLIA_CHAIN_ID) {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARB_SEPOLIA_CHAIN_ID }],
        }).catch(() => {
          // Chain not added yet — add it
          return eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: ARB_SEPOLIA_CHAIN_ID,
              chainName: 'Arbitrum Sepolia',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
              blockExplorerUrls: ['https://sepolia.arbiscan.io'],
            }],
          })
        })
        const newId: string = await eth.request({ method: 'eth_chainId' })
        setChainId(newId)
      }
    } catch (e: any) {
      setError(e?.message ?? 'Connection failed')
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const getSigner = useCallback((): null => null, [address])

  return { address, chainId, isCorrectChain, isConnecting, error, connect, getSigner }
}

// Async version used by action handlers
export async function getWalletSigner(): Promise<ethers.JsonRpcSigner> {
  const eth = (window as any).ethereum
  if (!eth) throw new Error('No wallet connected')
  const provider = new ethers.BrowserProvider(eth)
  return provider.getSigner()
}
