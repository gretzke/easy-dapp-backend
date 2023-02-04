import * as functions from "firebase-functions";
const cors = require("cors")({ origin: true });
const f = functions.region("europe-west1");
const jwt = require("jsonwebtoken");

export const createRequest = (callback: (req: any, res: any) => void, authenticated = false) => {
  return f.https.onRequest((req, res) => {
    cors(req, res, async () => {
      if (authenticated) {
        const data = getUser(req);
        if (!data) return res.sendStatus(401);
        req.body.session = { address: data };
      }
      try {
        if (req.body.data == undefined) return res.status(400).json(getError("PARSE_ERROR"));
        return await callback(req, res);
      } catch (e) {
        return res.status(500).json(getError("INTERNAL_ERROR", undefined, e));
      }
    });
  });
};

export const getUser = (req: any): string | undefined => {
  const token = req?.headers?.authorization;
  if (!token) return undefined;
  try {
    const data = jwt.verify(token.replace("Bearer ", ""), process.env.AUTH_SECRET);
    return data.address;
  } catch {
    return undefined;
  }
};

export const getError = (message: string, details?: string, stackTrace?: unknown) => {
  const error = { message, details };
  logError(error, stackTrace);
  return { error };
};

const logError = (...error: any[]) => {
  functions.logger.error(...error);
};
