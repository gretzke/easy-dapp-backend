import { ethers } from "ethers";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { storeAbi } from "./abi";
import { createRequest, getError, getUser } from "./firebaseUtil";
import { userId } from "./moralis";
import { getListType, isSupportedNetwork } from "./util";
const { binary_to_base58 } = require("base58-js");

export const createDapp = createRequest(async (req, res) => {
  let { chainId, address, abi, config, url, proxy } = req.body.data;
  address = address.toLowerCase();

  if (!isSupportedNetwork(chainId)) return res.status(400).json(getError("PARSE_ERROR", "UNSUPPORTED_NETWORK"));

  if (!config || !config.name) {
    return res.status(400).json(getError("PARSE_ERROR", "NAME_MISSING"));
  }
  const owner: string = req.body.session?.address.toLowerCase();

  const ownerRef = admin.firestore().collection("users").doc(userId(owner));

  const ownerData = await ownerRef.get();
  if (!ownerData.exists) return res.status(400).json(getError("PARSE_ERROR", "OWNER_NOT_FOUND"));

  const dappCount = ownerData.data()?.dappCount?.[chainId] ?? 0;
  console.log(dappCount);
  if (dappCount >= 5) return res.status(400).json(getError("PARSE_ERROR", "TOO_MANY_DAPPS"));

  url = url.replace(/\s+$/, "").replace(/ /g, "-").toLowerCase();

  // save abi if not in database
  if (!abi.match(/\/abi\/(0x[a-fA-F0-9]{64})/)) {
    try {
      JSON.parse(abi);
    } catch (e) {
      return res.status(400).json(getError("PARSE_ERROR", "INVALID_ABI"));
    }

    abi = await storeAbi(chainId, address, abi, false, proxy === true);
  }

  const id = getId(owner, url);

  const result = await admin.firestore().collection("dapps").doc(id).get();
  if (result.exists) {
    return res.status(400).json(getError("PARSE_ERROR", "DAPP_EXISTS"));
  }

  // todo test
  const abiRef = admin.firestore().collection("abi").doc(abi);
  if (!(await abiRef.get()).exists) {
    return res.status(400).json(getError("PARSE_ERROR", "ABI_NOT_FOUND"));
  }

  await admin
    .firestore()
    .collection("config")
    .doc("dapps")
    .update({
      ["count." + chainId + ".dapps"]: FieldValue.increment(1),
    });

  await admin
    .firestore()
    .collection("users")
    .doc(userId(owner))
    .update({
      ["dappCount." + chainId]: FieldValue.increment(1),
    });

  await admin
    .firestore()
    .collection("dapps")
    .doc(id)
    .set({
      chainId,
      address,
      abi: abiRef,
      config,
      owner,
      url,
      createdAt: FieldValue.serverTimestamp(),
      lastUpdatedAt: FieldValue.serverTimestamp(),
      likes: 0,
      proxy: (await abiRef.get()).data()?.proxy ?? false,
    });

  return res.status(200).json({ data: { owner, url } });
}, true);

export const saveDapp = createRequest(async (req, res) => {
  let { id, config } = req.body.data;

  if (!config || !config.name) {
    return res.status(400).json(getError("PARSE_ERROR", "NAME_MISSING"));
  }

  const doc = await admin.firestore().collection("dapps").doc(id).get();

  if (!doc.exists) {
    return res.status(400).json(getError("PARSE_ERROR", "DAPP_DOES_NOT_EXISTS"));
  }

  const owner = req.body.session.address;
  const registeredOwner = doc.data()?.owner;
  if (!registeredOwner || registeredOwner !== owner) {
    return res.status(400).json(getError("PARSE_ERROR", "NOT_OWNER"));
  }

  doc.ref.update({
    config,
    lastUpdatedAt: FieldValue.serverTimestamp(),
  });

  return res.status(200).json({});
}, true);

export const deleteDapp = createRequest(async (req, res) => {
  let { id } = req.body.data;

  if (!id) {
    return res.status(400).json(getError("PARSE_ERROR", "INVALID_ID"));
  }

  const doc = await admin.firestore().collection("dapps").doc(id).get();

  if (!doc.exists) {
    return res.status(400).json(getError("PARSE_ERROR", "DAPP_DOES_NOT_EXISTS"));
  }

  const owner = req.body.session.address.toLowerCase();
  const registeredOwner = doc.data()?.owner.toLowerCase();
  const chainId = doc.data()?.chainId;
  if (!registeredOwner || registeredOwner !== owner) {
    return res.status(400).json(getError("PARSE_ERROR", "NOT_OWNER"));
  }

  const db = admin.firestore();
  const ref = db.collection("dapps").doc(id);
  await db.recursiveDelete(ref);

  await admin
    .firestore()
    .collection("config")
    .doc("dapps")
    .update({
      ["count." + chainId + ".dapps"]: FieldValue.increment(-1),
    });

  await admin
    .firestore()
    .collection("users")
    .doc(userId(owner))
    .update({
      ["dappCount." + chainId]: FieldValue.increment(-1),
    });

  return res.status(200).json({});
}, true);

export const likeDapp = createRequest(async (req, res) => {
  let { id, like } = req.body.data;

  if (!id) {
    return res.status(400).json(getError("PARSE_ERROR", "INVALID_ID"));
  }

  const doc = admin.firestore().collection("dapps").doc(id);
  const dapp = await doc.get();

  if (!dapp.exists) {
    return res.status(400).json(getError("PARSE_ERROR", "DAPP_DOES_NOT_EXISTS"));
  }

  const chainId = dapp.data()?.chainId;
  const user = req.body.session.address.toLowerCase();
  const uid = userId(user);
  const likesRef = doc.collection("likeUsers").doc(uid);

  if (like === true) {
    if ((await likesRef.get()).exists) return;
    await likesRef.set({ id: uid, chainId, likedAt: FieldValue.serverTimestamp(), dapp: id });
    await doc.update({
      likes: FieldValue.increment(1),
    });
  } else {
    if (!(await likesRef.get()).exists) return;
    await likesRef.delete();
    await doc.update({
      likes: FieldValue.increment(-1),
    });
  }

  return res.status(200).json({});
}, true);

export const getDapps = createRequest(async (req, res) => {
  let { chainId, type, pagination, address } = req.body.data;

  const limit = 5;

  if (!pagination) return res.status(400).json(getError("PARSE_ERROR", "PAGINATION_MISSING"));

  const listType = getListType(type) ?? "popular";

  if (!isSupportedNetwork(chainId)) return res.status(400).json(getError("PARSE_ERROR", "UNSUPPORTED_NETWORK"));

  let total;

  let query = admin.firestore().collection("dapps").where("chainId", "==", chainId);

  if (address && ethers.utils.isAddress(address)) {
    address = address.toLowerCase();
    if (listType === "user") {
      query = query.where("owner", "==", address);
      const count = await query.count().get();
      total = count.data().count;
    } else if (listType === "liked") {
      address = userId(address);

      query = admin
        .firestore()
        .collectionGroup("likeUsers")
        .where("id", "==", address)
        .where("chainId", "==", chainId)
        .orderBy("likedAt", "desc");

      const count = await query.count().get();
      total = count.data().count;

      let offset;
      if (pagination.type === "next" && pagination.next) {
        offset = pagination.next;
      } else if (pagination.type === "prev" && pagination.prev.length > 1) {
        offset = pagination.prev[pagination.prev.length - 2];
      }
      console.log(offset);
      // 1675296921750
      // 1675296907932
      if (offset) {
        offset = Timestamp.fromMillis(offset);
        query = query.startAfter(offset);
      }

      const result = await query.limit(limit).get();

      const data: Promise<any>[] = [];
      result.forEach((doc) => {
        console.log(doc.data().likedAt);
        const parentPromise = doc.ref.parent.parent?.get();
        if (!parentPromise) throw new Error("Parent is empty");
        data.push(parentPromise.then((parent) => ({ ...parent.data(), id: parent.id, likedAt: doc.data().likedAt })));
      });
      return res.status(200).json({ data: await Promise.all(data), total, limit });
    }
  }

  if (listType === "popular") {
    query = query.orderBy("likes", "desc");
    const count = await admin.firestore().collection("config").doc("dapps").get();
    total = count.get("count." + chainId + ".dapps") ?? 0;
  } else if (listType === "latest") {
    query = query.orderBy("createdAt", "desc");
    const count = await admin.firestore().collection("config").doc("dapps").get();
    total = count.get("count." + chainId + ".dapps") ?? 0;
  }

  let offset;
  if (pagination.type === "next" && pagination.next) {
    offset = await admin.firestore().collection("dapps").doc(pagination.next).get();
  } else if (pagination.type === "prev" && pagination.prev.length > 1) {
    const prev = pagination.prev[pagination.prev.length - 2];
    offset = await admin.firestore().collection("dapps").doc(prev).get();
  }
  if (offset) {
    query = query.startAfter(offset);
  }

  const result = await query.limit(limit).get();
  res.status(200).json({ data: result.docs.map((doc) => ({ ...doc.data(), id: doc.id })), total, limit });
});

export const getDapp = createRequest(async (req, res) => {
  let { id, address } = req.body.data;

  const doc = await admin.firestore().collection("dapps").doc(id);
  const result = await doc.get();

  if (!result.exists) {
    return res.status(404).json(getError("PARSE_ERROR", "DAPP_NOT_FOUND"));
  }

  const abiRef = result.get("abi");
  const abiSnapshot = await abiRef.get();

  if (!abiSnapshot.exists) {
    return res.status(404).json(getError("PARSE_ERROR", "ABI_NOT_FOUND"));
  }

  const abiField = abiSnapshot.get("abi");

  let user = getUser(req);
  if (!user) {
    if (address && ethers.utils.isAddress(address)) {
      user = userId(address.toLowerCase());
    }
  } else user = userId(user.toLowerCase());

  let liked = false;
  if (user) {
    const likesRef = await doc.collection("likeUsers").doc(user).get();
    liked = likesRef.exists;
  }

  const data = {
    ...result.data(),
    abi: abiField,
    id: result.id,
    liked,
  };

  return res.status(200).json({ data });
});

export const dappExists = createRequest(async (req, res) => {
  let { id } = req.body.data;

  const result = await admin.firestore().collection("dapps").doc(id).get();

  return res.status(200).json({ data: result.exists });
});

const getId = (owner: string, url: string) => {
  const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`${owner.toLowerCase()}${url}`));
  return binary_to_base58(ethers.utils.arrayify(hash));
};
