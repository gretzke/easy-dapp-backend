import { isAddress } from "ethers/lib/utils";
import { createRequest, getError } from "./firebaseUtil";
import * as admin from "firebase-admin";
import { ethers } from "ethers";
const Moralis = require("moralis").default;
// const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { binary_to_base58 } = require("base58-js");

Moralis.start({
  apiKey: process.env.MORALIS_KEY as string,
});

const config = {
  domain: process.env.APP_DOMAIN,
  statement: "Please sign this message to confirm your identity.",
  uri: process.env.INTERFACE_URL,
  timeout: 60,
  network: "evm",
  chain: 1,
};

export const requestMessage = createRequest(async (req, res) => {
  let address = req.body.data.address;

  if (!isAddress(address)) return res.status(400).json(getError("PARSE_ERROR", "INVALID_ADDRESS"));

  address = address.toLowerCase();

  const data = await Moralis.Auth.requestMessage({ address, ...config });
  res.status(200).json({ data });
});

export const verify = createRequest(async (req, res) => {
  const signature = req.body.data.signature;
  const message = req.body.data.message;
  if (!message || !signature)
    return res.status(400).json(getError("PARSE_ERROR", "MISSING_SIGNATURE_OR_MESSAGE", { message, signature }));

  try {
    let { address, profileId } = (
      await Moralis.Auth.verify({
        message,
        signature,
        networkType: "evm",
      })
    ).raw;
    address = address.toLowerCase();

    const user = { address, profileId, signature };
    // create JWT token
    const token = jwt.sign(user, process.env.AUTH_SECRET);
    // set JWT cookie
    res.cookie("jwt", token, {
      httpOnly: true,
    });

    const id = userId(address);
    const doc = await admin.firestore().collection("users").doc(id).get();
    if (!doc.exists) {
      await admin.firestore().collection("users").doc(id).set({
        address,
      });
    }

    res.status(200).json({ data: user, session: token });
  } catch (error) {
    res.status(400).json(getError("SIGNATURE_VERIFICATION", "SIGNATURE_VERIFICATION_FAILED", error));
  }
});

export const userId = (address: string) => {
  return binary_to_base58(ethers.utils.arrayify(address.toLowerCase()));
};
