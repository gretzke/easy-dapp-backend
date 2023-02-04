import { ethers } from "ethers";
import { isAddress } from "ethers/lib/utils";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { createRequest, getError } from "./firebaseUtil";
import { supportedNetworks } from "./util";
const axios = require("axios");
const { binary_to_base58 } = require("base58-js");

export const getAbi = createRequest(async (req, res) => {
  const chainId = req.body.data.chainId;
  let address = req.body.data.address;
  let proxy = req.body.data.proxy;
  if (chainId == undefined) return res.status(400).json(getError("PARSE_ERROR", "INVALID_CHAIN_ID"));

  if (!isAddress(address)) return res.status(400).json(getError("PARSE_ERROR", "INVALID_ADDRESS"));

  address = address.toLowerCase();
  let abi = "";

  // if abi not in database, fetch from etherscan
  const network = supportedNetworks[chainId];
  if (network === undefined || network.explorer === undefined)
    return res.status(400).send(getError("ETHERSCAN_UNSUPPORTED_CHAIN", chainId));

  let query = admin
    .firestore()
    .collection("abi")
    .where("chainId", "==", chainId)
    .where("address", "==", address)
    .where("verified", "==", true)
    .where("proxy", "==", proxy);

  const result = await query.get();

  if (!result.empty) {
    const id = result.docs[0].id;
    abi = result.docs[0].data().abi;
    const verified = result.docs[0].data().verified;
    return res.status(200).json({ data: { id, abi, verified } });
  }

  const etherscan = network.explorer;

  let response;
  let implementation = "";
  // check if contract is a proxy
  try {
    response = await axios.get(
      `${etherscan.url}api?module=contract&action=getsourcecode&address=${address}&apikey=${etherscan.key}`
    );
    implementation = response.data.result[0].Implementation;
    if (implementation === "" && !proxy) {
      // not a proxy
      abi = response.data.result[0].ABI;
      if (abi === "Contract source code not verified") {
        return res.status(400).send(getError("ETHERSCAN_VERIFICATION_ERROR", "CONTRACT_NOT_VERIFIED"));
      }
      const id = await storeAbi(chainId, address, abi, true, false);
      return res.status(200).json({ data: { abi, id: id, verified: true, proxy: false } });
    } else if (implementation === "" && proxy) {
      return res.status(400).send(getError("ETHERSCAN_VERIFICATION_ERROR", "PROXY_NOT_VERIFIED"));
    }
  } catch (e) {
    return res.status(500).send(getError("ETHERSCAN_ERROR", undefined, e));
  }

  // get abi if contract is a proxy
  try {
    response = await axios.get(
      `${etherscan.url}api?module=contract&action=getabi&address=${implementation}&apikey=${etherscan.key}`
    );
    if (response.data.status === "0") {
      if (response.data.result === "Contract source code not verified") {
        return res.status(400).send(getError("ETHERSCAN_VERIFICATION_ERROR", "PROXY_NOT_VERIFIED"));
      }

      return res.status(400).send(getError("ETHERSCAN_VERIFICATION_ERROR", response.data));
    }
    abi = response.data.result;
  } catch (e) {
    return res.status(500).send(getError("ETHERSCAN_ERROR", undefined, e));
  }

  const id = await storeAbi(chainId, address, abi, true, true);

  return res.status(200).json({ data: { abi, id: id, verified: true, proxy: true } });
});

export const storeAbi = async (
  chainId: number,
  address: string,
  abi: string,
  verified: boolean,
  proxy: boolean
): Promise<string> => {
  abi = JSON.stringify(JSON.parse(abi));
  const id = getAbiId(chainId, address, abi);

  const res = await admin.firestore().collection("abi").doc(id).get();

  if (res.exists) return id;

  await admin
    .firestore()
    .collection("config")
    .doc("dapps")
    .update({
      ["count." + chainId + ".abis"]: FieldValue.increment(1),
    });

  await admin.firestore().collection("abi").doc(id).set({
    chainId,
    address,
    abi,
    verified,
    proxy,
  });
  return id;
};

const getAbiId = (chainId: number, address: string, abi: string) => {
  const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`${chainId}${address.toLowerCase()}${abi}`));
  return binary_to_base58(ethers.utils.arrayify(hash));
};
