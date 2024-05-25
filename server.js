import { createRequestHandler } from "@react-router/express";
import {
  createReactServerRequestHandler,
  installGlobals,
} from "@react-router/node";
import compression from "compression";
import express from "express";
import morgan from "morgan";

const prerenderBuild = await import("./build/prerender/prerender-build.js");
const serverBuild = await import("./build/server/server-build.js");

installGlobals({
  clientReferences: prerenderBuild.clientReferences,
  serverReferences: serverBuild.serverReferences,
});

const serverRequestHandler = createReactServerRequestHandler(serverBuild);

const reactRouterHandler = createRequestHandler({
  build: prerenderBuild,
  callServer: (url, init) => {
    return serverRequestHandler(new Request(url, init));
  },
});

const app = express();

app.use(compression());
app.disable("x-powered-by");

app.use(
  "/assets",
  express.static("build/browser/assets", { immutable: true, maxAge: "1y" })
);

app.use(express.static("build/browser", { maxAge: "1h" }));
app.use(morgan("tiny"));

app.all("*", reactRouterHandler);

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Express server listening at http://localhost:${port}`)
);
