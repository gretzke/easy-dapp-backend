const etherscanKey = process.env.ETHERSCAN_KEY as string;
const bscscanKey = process.env.BSCSCAN_KEY as string;
const polygonscanKey = process.env.POLYGONSCAN_KEY as string;
const arbiscanKey = process.env.ARBISCAN_KEY as string;
const optimismscanKey = process.env.OPTIMISMSCAN_KEY as string;
const gnosisscanKey = process.env.GNOSISSCAN_KEY as string;
const ftmscanKey = process.env.FTMSCAN_KEY as string;

export interface SupportedNetwork {
  explorer?: {
    url: string;
    key: string;
  };
}

export interface SupportedNetworks {
  [chainId: number]: SupportedNetwork;
}

export type DappListType = "popular" | "latest" | "user" | "liked";

const listSet = new Set<DappListType>(["popular", "latest", "user", "liked"]);

export const getListType = (type: any): DappListType | undefined => {
  return listSet.has(type) ? type : undefined;
};

export const supportedNetworks: SupportedNetworks = {
  1: { explorer: { url: "https://api.etherscan.io/", key: etherscanKey } },
  5: { explorer: { url: "https://api-goerli.etherscan.io/", key: etherscanKey } },
  11155111: { explorer: { url: "https://api-sepolia.etherscan.io/", key: etherscanKey } },
  56: { explorer: { url: "https://api.bscscan.com/", key: bscscanKey } },
  97: { explorer: { url: "https://api-testnet.bscscan.com/", key: bscscanKey } },
  137: { explorer: { url: "https://api.polygonscan.com/", key: polygonscanKey } },
  80001: { explorer: { url: "https://api-testnet.polygonscan.com/", key: polygonscanKey } },
  42161: { explorer: { url: "https://api.arbiscan.io/", key: arbiscanKey } },
  421613: { explorer: { url: "https://api-goerli.arbiscan.io/", key: arbiscanKey } },
  10: { explorer: { url: "https://api-optimistic.etherscan.io/", key: optimismscanKey } },
  420: { explorer: { url: "https://api-goerli-optimistic.etherscan.io/", key: optimismscanKey } },
  100: { explorer: { url: "https://api.blockscout.com/xdai/mainnet/", key: gnosisscanKey } },
  250: { explorer: { url: "https://api.ftmscan.com/", key: ftmscanKey } },
  4002: { explorer: { url: "https://api-testnet.ftmscan.com/", key: ftmscanKey } },
  324: {},
  280: {},
  43114: {},
  43113: {},
};

export const isSupportedNetwork = (chainId: number) => {
  return supportedNetworks[chainId] !== undefined;
};
