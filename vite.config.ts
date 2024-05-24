import { type BinaryLike, createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { flatRoutes } from "@react-router/dev/dist/config/flatRoutes";
import type { Manifest as ReactRouterManifest } from "@react-router/dev/dist/manifest";
import type {
  ConfigRoute,
  RouteManifest,
} from "@react-router/dev/dist/config/routes";

import react from "@vitejs/plugin-react";
import * as esbuild from "esbuild";
import * as lexer from "es-module-lexer";
import { clientTransform, serverTransform } from "unplugin-rsc";
import type * as Vite from "vite";
import { createServerModuleRunner, defineConfig, normalizePath } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import * as adapter from "./node-adapter";
import { removeExports } from "./remove-exports";

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
});

const js = String.raw;

type CachedPromise<T> = Promise<T> & {
  status: "pending" | "fulfilled" | "rejected";
  value?: unknown;
  reason?: unknown;
};

declare global {
  var reactRouterViteContext: {
    appDirectory: string;
    basename: string;
    browserManifest?: Vite.Manifest;
    clientModulePromiseCache?: Map<string, CachedPromise<unknown>>;
    clientModules: Set<string>;
    entryBrowserFilePath: string;
    entryPrerenderFilePath: string;
    entryServerFilePath: string;
    fullRouteIds: Set<string>;
    prerenderRunner?: ReturnType<typeof createServerModuleRunner>;
    rootDirectory: string;
    routes: RouteManifest;
    serverModulePromiseCache?: Map<string, CachedPromise<unknown>>;
    serverModules: Set<string>;
    serverRunner?: ReturnType<typeof createServerModuleRunner>;
  };
}

global.reactRouterViteContext = global.reactRouterViteContext ?? undefined;

async function reactRouter(): Promise<Vite.PluginOption[]> {
  await lexer.init;

  reactRouterViteContext = global.reactRouterViteContext ?? {
    appDirectory: path.resolve("app"),
    basename: "/",
    entryBrowserFilePath: await fsp.realpath(
      path.resolve(
        "node_modules/@react-router/dev/dist/config/defaults/entry.client.rsc.tsx"
      )
    ),
    entryPrerenderFilePath: await fsp.realpath(
      path.resolve(
        "node_modules/@react-router/dev/dist/config/defaults/entry.server.node.rsc.tsx"
      )
    ),
    entryServerFilePath: await fsp.realpath(
      path.resolve(
        "node_modules/@react-router/dev/dist/config/defaults/entry.react-server.node.tsx"
      )
    ),
    rootDirectory: path.resolve("."),
    clientModules: new Set(),
    serverModules: new Set(),
    routes: {},
    fullRouteIds: new Set(),
  };
  reactRouterViteContext.routes = flatRoutes(
    reactRouterViteContext.appDirectory,
    [".*"]
  );
  const rootFile = await findEntry(reactRouterViteContext.appDirectory, "root");
  if (!rootFile) throw new Error("No root file found");
  reactRouterViteContext.routes.root = {
    file: rootFile,
    id: "root",
    path: "",
  };
  reactRouterViteContext.fullRouteIds = new Set(
    Object.values(reactRouterViteContext.routes).map((route) =>
      path.resolve(reactRouterViteContext.appDirectory, route.file)
    )
  );

  const virtualBrowserEntry = virtualModule(
    "virtual:react-router/browser-build"
  );
  const virtualClientReferences = virtualModule(
    "virtual:react-router/client-references"
  );
  const virtualManifest = virtualModule("virtual:react-router/manifest");
  const virtualPrerenderEntry = virtualModule(
    "virtual:react-router/prerender-build"
  );
  const virtualReactPreamble = virtualModule(
    "virtual:react-router/react-preamble"
  );
  const virtualServerEntry = virtualModule("virtual:react-router/server-build");
  const virtualServerReferences = virtualModule(
    "virtual:react-router/server-references"
  );
  const virtualModules = [
    virtualBrowserEntry,
    virtualClientReferences,
    virtualManifest,
    virtualPrerenderEntry,
    virtualReactPreamble,
    virtualServerEntry,
    virtualServerReferences,
  ];

  const SERVER_ONLY_ROUTE_EXPORTS = ["loader", "action", "headers"];
  const CLIENT_ROUTE_EXPORTS = [
    "clientAction",
    "clientLoader",
    "default",
    "ErrorBoundary",
    "handle",
    "HydrateFallback",
    "Layout",
    "links",
    "meta",
    "shouldRevalidate",
  ];

  function createVirtualBrowserEntry(mode?: "build" | "dev" | "scan") {
    if (mode === "dev") {
      return js`
        import "${virtualReactPreamble.id}";
        import manifest from "${virtualManifest.id}";
        window.__remixManifest = manifest;
        import("${reactRouterViteContext.entryBrowserFilePath}");
      `;
    }

    return js`
      import "${reactRouterViteContext.entryBrowserFilePath}";
    `;
  }

  function createVirtualPrerenderEntry() {
    const routes = reactRouterViteContext.routes;
    if (!routes) throw new Error("No routes found");

    return js`
      import * as entryServer from ${JSON.stringify(
        resolveFileUrl(
          reactRouterViteContext,
          reactRouterViteContext.entryPrerenderFilePath
        )
      )};
      ${Object.keys(routes)
        .map((key, index) => {
          const route = routes[key];
          if (!route) throw new Error("Route missing");

          return `import * as route${index} from ${JSON.stringify(
            resolveFileUrl(
              reactRouterViteContext,
              resolveRelativeRouteFilePath(
                route,
                reactRouterViteContext.appDirectory
              )
            )
          )};`;
        })
        .join("\n")}
      export { default as assets } from ${JSON.stringify(virtualManifest.id)};
      export const assetsBuildDirectory = ${JSON.stringify(
        path.relative(reactRouterViteContext.rootDirectory, "build/browser")
      )};
      export const basename = ${JSON.stringify(
        reactRouterViteContext.basename
      )};
      export const future = { unstable_serverComponents: true };
      export const isSpaMode = false;
      export const publicPath = ${JSON.stringify(
        reactRouterViteContext.basename
      )};
      export const entry = { module: entryServer };
      export const routes = {
        ${Object.keys(routes)
          .map((key, index) => {
            const route = routes[key];
            if (!route) throw new Error("Route missing");
            return `${JSON.stringify(key)}: {
          id: ${JSON.stringify(route.id)},
          parentId: ${JSON.stringify(route.parentId)},
          path: ${JSON.stringify(route.path)},
          index: ${JSON.stringify(route.index)},
          caseSensitive: ${JSON.stringify(route.caseSensitive)},
          module: route${index}
        }`;
          })
          .join(",\n  ")}
      };
      export { default as clientReferences } from ${JSON.stringify(
        virtualClientReferences.id
      )};
    `;
  }

  function createVirtualServerEntry() {
    const routes = reactRouterViteContext.routes;
    if (!routes) throw new Error("No routes found");

    return js`
      import * as entryServer from ${JSON.stringify(
        resolveFileUrl(
          reactRouterViteContext,
          reactRouterViteContext.entryServerFilePath
        )
      )};
      ${Object.keys(routes)
        .map((key, index) => {
          const route = routes[key];
          if (!route) throw new Error("Route missing");
          return `import * as route${index} from ${JSON.stringify(
            resolveFileUrl(
              reactRouterViteContext,
              resolveRelativeRouteFilePath(
                route,
                reactRouterViteContext.appDirectory
              )
            )
          )};`;
        })
        .join("\n")}
      export const future = { unstable_serverComponents: true };
      export const basename = ${JSON.stringify(
        reactRouterViteContext.basename
      )};
      export const entry = { module: entryServer };
      export const routes = {
        ${Object.keys(routes)
          .map((key, index) => {
            const route = routes[key];
            if (!route) throw new Error("Route missing");
            return `${JSON.stringify(key)}: {
        id: ${JSON.stringify(route.id)},
        parentId: ${JSON.stringify(route.parentId)},
        path: ${JSON.stringify(route.path)},
        index: ${JSON.stringify(route.index)},
        caseSensitive: ${JSON.stringify(route.caseSensitive)},
        module: route${index}
      }`;
          })
          .join(",\n  ")}
      };`;
  }

  function createVirtualClientReferences() {
    let result = "export default {";
    for (const clientModule of reactRouterViteContext.clientModules) {
      result += `${JSON.stringify(
        prodHash(clientModule, "use client")
      )}: () => import(${JSON.stringify(clientModule)}),`;
    }
    return `${result}};`;
  }

  function createVirtualServerReferences() {
    let result = "export default {";
    for (const serverModule of reactRouterViteContext.serverModules) {
      result += `${JSON.stringify(
        prodHash(serverModule, "use server")
      )}: () => import(${JSON.stringify(serverModule)}),`;
    }
    return `${result}};`;
  }

  async function createVirtualManifest(mode?: "build" | "dev" | "scan") {
    if (mode === "dev") {
      const manifest = await getReactRouterManifestForDev();
      return js`
        const manifest = ${JSON.stringify(manifest, null, 2)};
        if (typeof window !== "undefined") {
          window.__remixManifest = manifest;
        }
        export default manifest;
      `;
    }
    const { reactRouterServerManifest } =
      await generateReactRouterManifestsForBuild();
    return js`
      const manifest = ${JSON.stringify(reactRouterServerManifest)};
      if (typeof window !== "undefined") {
        window.__remixManifest = manifest;
      }
      export default manifest;
    `;
  }

  function createReactPreamble() {
    return react.preambleCode.replace(
      "__BASE__",
      reactRouterViteContext.basename
    );
  }

  // In dev, the server and browser manifests are the same
  async function getReactRouterManifestForDev() {
    const routes: Record<string, any> = {};

    if (!reactRouterViteContext.routes) throw new Error("No routes found");
    const routeManifestExports = await getRouteManifestModuleExports();

    if (!reactRouterViteContext.routes) throw new Error("No routes found");

    for (const [key, route] of Object.entries(reactRouterViteContext.routes)) {
      const sourceExports = routeManifestExports[key];
      routes[key] = {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        module: path.posix.join(
          reactRouterViteContext.basename,
          `${resolveFileUrl(
            reactRouterViteContext,
            resolveRelativeRouteFilePath(
              route,
              reactRouterViteContext.appDirectory
            )
          )}`
        ),
        hasAction: sourceExports.includes("action"),
        hasLoader: sourceExports.includes("loader"),
        hasClientAction: sourceExports.includes("clientAction"),
        hasClientLoader: sourceExports.includes("clientLoader"),
        hasErrorBoundary: sourceExports.includes("ErrorBoundary"),
        imports: [],
      };
    }

    return {
      version: String(Math.random()),
      url: path.posix.join(
        reactRouterViteContext.basename,
        virtualManifest.url
      ),
      hmr: {
        runtime: path.posix.join(
          reactRouterViteContext.basename,
          virtualReactPreamble.url
        ),
      },
      entry: {
        module: path.posix.join(
          reactRouterViteContext.basename,
          virtualBrowserEntry.url
        ),
        imports: [],
      },
      routes,
      future: { unstable_serverComponents: true },
    };
  }

  async function generateReactRouterManifestsForBuild(): Promise<{
    reactRouterBrowserManifest: ReactRouterManifest;
    reactRouterServerManifest: ReactRouterManifest;
  }> {
    const viteManifest = reactRouterViteContext.browserManifest;
    if (!viteManifest) {
      throw new Error("No Vite manifest found");
    }

    const entry = getReactRouterManifestBuildAssets(
      reactRouterViteContext,
      viteManifest,
      reactRouterViteContext.entryBrowserFilePath
    );

    const browserRoutes: ReactRouterManifest["routes"] = {};
    const serverRoutes: ReactRouterManifest["routes"] = {};

    const routeManifestExports = await getRouteManifestModuleExports();

    for (const [key, route] of Object.entries(reactRouterViteContext.routes)) {
      const routeFilePath = path.join(
        reactRouterViteContext.appDirectory,
        route.file
      );
      const sourceExports = routeManifestExports[key];
      const isRootRoute = route.parentId === undefined;

      const routeManifestEntry = {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        hasAction: sourceExports.includes("action"),
        hasLoader: sourceExports.includes("loader"),
        hasClientAction: sourceExports.includes("clientAction"),
        hasClientLoader: sourceExports.includes("clientLoader"),
        hasErrorBoundary: sourceExports.includes("ErrorBoundary"),
        ...getReactRouterManifestBuildAssets(
          reactRouterViteContext,
          viteManifest,
          routeFilePath,
          // If this is the root route, we also need to include assets from the
          // client entry file as this is a common way for consumers to import
          // global reset styles, etc.
          isRootRoute ? [reactRouterViteContext.entryBrowserFilePath] : []
        ),
      };

      browserRoutes[key] = routeManifestEntry;

      const serverBundleRoutes = reactRouterViteContext.routes;
      if (!serverBundleRoutes || serverBundleRoutes[key]) {
        serverRoutes[key] = routeManifestEntry;
      }
    }

    const fingerprintedValues = { entry, routes: browserRoutes };
    const version = getHash(JSON.stringify(fingerprintedValues), 8);
    const manifestPath = path.posix.join("assets", `manifest-${version}.js`);
    const url = `${reactRouterViteContext.basename}${manifestPath}`;
    const nonFingerprintedValues = { url, version };

    const reactRouterBrowserManifest: ReactRouterManifest = {
      ...fingerprintedValues,
      ...nonFingerprintedValues,
    };

    // Write the browser manifest to disk as part of the build process
    await writeFileSafe(
      path.join(path.resolve("build/browser"), manifestPath),
      js`
        const manifest = ${JSON.stringify(reactRouterBrowserManifest)};
        if (typeof window !== "undefined") {
          window.__remixManifest = manifest;
        }
        export default manifest;
      `
    );

    // The server manifest is the same as the browser manifest, except for
    // server bundle builds which only includes routes for the current bundle,
    // otherwise the server and client have the same routes
    const reactRouterServerManifest = {
      ...reactRouterBrowserManifest,
      routes: serverRoutes,
    };

    return {
      reactRouterBrowserManifest,
      reactRouterServerManifest,
    };
  }

  async function getRouteManifestModuleExports() {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(reactRouterViteContext.routes).map(
          async ([key, route]) => {
            const routePath = path.resolve(
              reactRouterViteContext.appDirectory,
              route.file
            );
            let source = await fsp.readFile(routePath, "utf-8");
            const loader = path.extname(routePath).slice(1) as
              | "js"
              | "ts"
              | "tsx";
            source = (
              await esbuild.transform(source, {
                loader,
                target: "esnext",
                format: "esm",
              })
            ).code;

            const [, parsedExports] = lexer.parse(source);

            const exportsList: string[] = [];
            for (const exportRange of parsedExports) {
              const name = source.slice(exportRange.s, exportRange.e);
              exportsList.push(name);
            }

            return [key, exportsList];
          }
        )
      )
    );
  }

  return [
    ...react(),
    {
      name: "react-router-rsc",
      buildStart() {},
      config(config, { command }) {
        return {
          builder: {
            async buildApp(builder) {
              let lastServerModulesSize =
                reactRouterViteContext.serverModules.size;
              let lastClientModulesSize =
                reactRouterViteContext.clientModules.size;
              let firstBuild = true;
              do {
                console.log("BUILDING Clients...");
                if (
                  firstBuild ||
                  lastClientModulesSize !==
                    reactRouterViteContext.clientModules.size
                ) {
                  const output = (await builder.build(
                    builder.environments.client
                  )) as Vite.Rollup.RollupOutput;
                  const manifestOutput = output.output.find(
                    (o) => o.fileName === ".vite/manifest.json"
                  );
                  if (!manifestOutput) {
                    throw new Error("No manifest output found");
                  }
                  reactRouterViteContext.browserManifest = JSON.parse(
                    (
                      manifestOutput as Vite.Rollup.OutputAsset
                    ).source.toString()
                  );
                  await builder.build(builder.environments.ssr);
                  lastClientModulesSize =
                    reactRouterViteContext.clientModules.size;
                }

                if (
                  firstBuild ||
                  lastServerModulesSize !==
                    reactRouterViteContext.serverModules.size
                ) {
                  await builder.build(builder.environments.server);
                  lastServerModulesSize =
                    reactRouterViteContext.serverModules.size;
                }
                firstBuild = false;
              } while (
                lastClientModulesSize !==
                  reactRouterViteContext.clientModules.size ||
                lastServerModulesSize !==
                  reactRouterViteContext.serverModules.size
              );
              console.log(reactRouterViteContext.clientModules);
            },
          },
          build: {
            rollupOptions: {
              preserveEntrySignatures: "exports-only",
            },
          },
          environments: {
            client: {
              build: {
                manifest: true,
                outDir: "build/browser",
                rollupOptions: {
                  input: [
                    command === "build"
                      ? reactRouterViteContext.entryBrowserFilePath
                      : virtualBrowserEntry.id,
                    ...Object.values(reactRouterViteContext.routes).map(
                      (route) =>
                        path.join(
                          reactRouterViteContext.appDirectory,
                          route.file
                        )
                    ),
                  ],
                },
              },
              dev: {
                optimizeDeps: {
                  include: [
                    "react",
                    "react/jsx-runtime",
                    "react/jsx-dev-runtime",
                    "react-dom",
                    "react-dom/client",
                    "react-router",
                    "react-server-dom-diy/client",
                  ],
                },
              },
              resolve: {
                dedupe: ["react", "react-dom", "react-dom/client"],
              },
            },
            ssr: {
              nodeCompatible: true,
              build: {
                outDir: "build/prerender",
                ssr: true,
                rollupOptions: {
                  input: [virtualPrerenderEntry.id],
                },
              },
              dev: {
                optimizeDeps: {
                  include: [
                    "react",
                    "react/jsx-runtime",
                    "react/jsx-dev-runtime",
                    "react-dom",
                    "react-dom/server",
                    "react-router",
                    "react-server-dom-diy/client",
                  ],
                },
              },
              resolve: {
                noExternal: true,
                external: ["@react-router/node"],
                dedupe: ["react", "react-dom", "react-dom/server"],
              },
            },
            server: {
              nodeCompatible: true,
              build: {
                outDir: "build/server",
                ssr: true,
                rollupOptions: {
                  input: [virtualServerEntry.id],
                  external: ["react-server-dom-diy/server"],
                },
              },
              resolve: {
                conditions: ["react-server"],
                externalConditions: ["react-server"],
                dedupe: ["react"],
              },
            },
          },
        };
      },
      resolveId(id) {
        for (const virtualModule of virtualModules) {
          if (id === virtualModule.id) {
            return virtualModule.resolvedId;
          }
        }
      },
      load(id) {
        switch (id) {
          case virtualBrowserEntry.resolvedId:
            return createVirtualBrowserEntry(this.environment?.mode);
          case virtualClientReferences.resolvedId:
            return createVirtualClientReferences();
          case virtualPrerenderEntry.resolvedId:
            return createVirtualPrerenderEntry();
          case virtualReactPreamble.resolvedId:
            return createReactPreamble();
          case virtualManifest.resolvedId:
            return createVirtualManifest(this.environment?.mode);
          case virtualServerEntry.resolvedId:
            return createVirtualServerEntry();
          case virtualServerReferences.resolvedId:
            return createVirtualServerReferences();
        }
      },
      transform(code, id) {
        if (reactRouterViteContext.fullRouteIds.has(id)) {
          const [filepath] = id.split("?");

          if (this.environment?.name === "server") {
            return removeExports(code, CLIENT_ROUTE_EXPORTS, {
              sourceMaps: true,
              filename: id,
              sourceFileName: filepath,
            });
          }

          return removeExports(code, SERVER_ONLY_ROUTE_EXPORTS, {
            sourceMaps: true,
            filename: id,
            sourceFileName: filepath,
          });
        }
      },
    },
    {
      name: "rsc-directives",
      transform(code, id) {
        const [filepath] = id.split("?");
        const ext = path.extname(filepath);

        if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
          return;
        }

        const hash = this.environment?.mode === "dev" ? devHash : prodHash;

        if (this.environment?.name === "server") {
          return serverTransform(code, filepath, {
            id: hash,
            importClient: "registerClientReference",
            importFrom: "react-server-dom-diy/server",
            importServer: "registerServerReference",
          });
        }

        return clientTransform(code, filepath, {
          id: hash,
          importFrom: "@react-router/dev/dist/runtime.client.js",
          importServer: "createServerReference",
        });
      },
    },
    {
      name: "react-router-dev-server",
      async hotUpdate({ environment, server, file, modules, read }) {
        try {
          const ids = modules
            .map((mod) => mod.id)
            .filter((id): id is string => !!id);

          reactRouterViteContext.serverRunner?.moduleCache.invalidateDepTree(
            ids
          );

          reactRouterViteContext.prerenderRunner?.moduleCache.invalidateDepTree(
            ids
          );

          if (environment.name === "server") {
            if (
              !ids.some((id) => reactRouterViteContext.clientModules.has(id))
            ) {
              server.environments.client.hot.send("react-router:hmr", {});
            }
            return [];
          }

          if (environment.name === "ssr") {
            return [];
          }

          if (environment.name === "client") {
            let route = getRoute(
              reactRouterViteContext.appDirectory,
              reactRouterViteContext.routes,
              file
            );

            type ManifestRoute = RouteManifest[string];
            type HmrEventData = { route: ManifestRoute | null };
            let hmrEventData: HmrEventData = { route: null };

            if (route) {
              // invalidate manifest on route exports change
              let serverManifest = (
                await server.ssrLoadModule(virtualManifest.id)
              ).default as ReactRouterManifest;

              let oldRouteMetadata = serverManifest.routes[route.id];
              let newRouteMetadata = (await getReactRouterManifestForDev())
                .routes[route.id];

              hmrEventData.route = newRouteMetadata;

              if (
                !oldRouteMetadata ||
                (
                  [
                    "hasLoader",
                    "hasClientLoader",
                    "hasAction",
                    "hasClientAction",
                    "hasErrorBoundary",
                  ] as const
                ).some((key) => oldRouteMetadata[key] !== newRouteMetadata[key])
              ) {
                reactRouterViteContext.serverRunner?.moduleCache.invalidateDepTree(
                  virtualModules.map((m) => m.id)
                );
              }
            }

            server.environments[environment.name].hot.send(
              "react-router:hmr",
              hmrEventData
            );
          }
        } finally {
          reactRouterViteContext.clientModulePromiseCache?.clear();
          reactRouterViteContext.serverModulePromiseCache?.clear();
        }
      },
      async configureServer(server) {
        reactRouterViteContext.prerenderRunner =
          reactRouterViteContext.prerenderRunner ??
          createServerModuleRunner(server.environments.ssr);
        reactRouterViteContext.serverRunner =
          reactRouterViteContext.serverRunner ??
          createServerModuleRunner(server.environments.server);
        const prerenderRunner = reactRouterViteContext.prerenderRunner;
        const serverRunner = reactRouterViteContext.serverRunner;

        reactRouterViteContext.clientModulePromiseCache =
          reactRouterViteContext.clientModulePromiseCache ?? new Map();
        reactRouterViteContext.serverModulePromiseCache =
          reactRouterViteContext.serverModulePromiseCache ?? new Map();
        const clientModulePromiseCache =
          reactRouterViteContext.clientModulePromiseCache;
        const serverModulePromiseCache =
          reactRouterViteContext.serverModulePromiseCache;

        global.__diy_server_manifest__ = {
          resolveClientReferenceMetadata(clientReference: { $$id: string }) {
            const id = clientReference.$$id;
            const idx = id.lastIndexOf("#");
            const exportName = id.slice(idx + 1);
            const fullURL = id.slice(0, idx);
            return [fullURL, exportName];
          },
          resolveServerReference(_id: string) {
            const idx = _id.lastIndexOf("#");
            const exportName = _id.slice(idx + 1);
            const id = _id.slice(0, idx);
            return {
              preloadModule() {
                if (serverModulePromiseCache.has(id)) {
                  return serverModulePromiseCache.get(
                    id
                  ) as CachedPromise<void>;
                }
                const promise = serverRunner
                  .import(id)
                  .then((mod) => {
                    promise.status = "fulfilled";
                    promise.value = mod;
                  })
                  .catch((res) => {
                    promise.status = "rejected";
                    promise.reason = res;
                    throw res;
                  }) as CachedPromise<void>;
                promise.status = "pending";
                serverModulePromiseCache.set(id, promise);
                return promise;
              },
              requireModule() {
                const cached = serverModulePromiseCache.get(id);
                if (!cached) throw new Error(`Module ${id} not found`);
                if (cached.reason) throw cached.reason;
                return (cached.value as Record<string, unknown>)[exportName];
              },
            };
          },
        };

        global.__diy_client_manifest__ = {
          resolveClientReference([id, exportName]: [string, string]) {
            return {
              preloadModule() {
                if (clientModulePromiseCache.has(id)) {
                  return clientModulePromiseCache.get(
                    id
                  ) as CachedPromise<void>;
                }
                const promise = prerenderRunner
                  .import(id)
                  .then((mod) => {
                    promise.status = "fulfilled";
                    promise.value = mod;
                  })
                  .catch((res) => {
                    promise.status = "rejected";
                    promise.reason = res;
                    throw res;
                  }) as CachedPromise<void>;
                promise.status = "pending";
                clientModulePromiseCache.set(id, promise);
                return promise;
              },
              requireModule() {
                const cached = clientModulePromiseCache.get(id);
                if (!cached) throw new Error(`Module ${id} not found`);
                if (cached.reason) throw cached.reason;
                return (cached.value as Record<string, unknown>)[exportName];
              },
            };
          },
        };

        const { createRequestHandler, createReactServerRequestHandler } =
          await import("@react-router/node");

        return () => {
          server.middlewares.use(async (req, res, next) => {
            try {
              const prerenderHandler = createRequestHandler(
                await prerenderRunner.import(virtualPrerenderEntry.id),
                "development",
                async (url, init) => {
                  const serverHandler = createReactServerRequestHandler(
                    await serverRunner.import(virtualServerEntry.id)
                  );
                  return serverHandler(new Request(url, init));
                }
              );

              const request = adapter.fromNodeRequest(req);
              const response = await prerenderHandler(request);
              await adapter.toNodeResponse(response, res);
            } catch (reason) {
              next(reason);
            }
          });
        };
      },
    },
  ];
}

function prodHash(str: string, type: "use client" | "use server") {
  switch (type) {
    case "use client":
      reactRouterViteContext.clientModules.add(str);
      break;
    case "use server":
      reactRouterViteContext.serverModules.add(str);
      break;
  }
  return `/${path.relative(process.cwd(), str)}`;
}

function devHash(str: string, type: "use client" | "use server") {
  switch (type) {
    case "use client":
      reactRouterViteContext.clientModules.add(str);
      break;
    case "use server":
      reactRouterViteContext.serverModules.add(str);
      break;
  }

  const resolved = path.resolve(str);
  let unixPath = resolved.replace(/\\/g, "/");
  if (!unixPath.startsWith("/")) {
    unixPath = `/${unixPath}`;
  }
  if (resolved.startsWith(process.cwd())) {
    return `/${path.relative(process.cwd(), unixPath)}`;
  }
  return `/@fs${unixPath}`;
}

function virtualModule(id: string) {
  return {
    id,
    resolvedId: `\0${id}`,
    url: `/@id/__x00__${id}`,
  };
}

function resolveFileUrl(
  { rootDirectory }: { rootDirectory: string },
  filePath: string
) {
  const relativePath = path.relative(rootDirectory, filePath);
  const isWithinRoot =
    !relativePath.startsWith("..") && !path.isAbsolute(relativePath);

  if (!isWithinRoot) {
    // Vite will prevent serving files outside of the workspace
    // unless user explictly opts in with `server.fs.allow`
    // https://vitejs.dev/config/server-options.html#server-fs-allow
    return path.posix.join("/@fs", normalizePath(filePath));
  }

  return `/${normalizePath(relativePath)}`;
}

function resolveRelativeRouteFilePath(
  route: ConfigRoute,
  appDirectory: string
) {
  return normalizePath(path.resolve(appDirectory, route.file));
}

const entryExts = [".js", ".jsx", ".ts", ".tsx"];
async function findEntry(
  dir: string,
  basename: string
): Promise<string | undefined> {
  for (const ext of entryExts) {
    const file = path.resolve(dir, basename + ext);
    if (
      await fsp
        .stat(file)
        .then((s) => s.isFile())
        .catch(() => false)
    )
      return path.relative(dir, file);
  }

  return undefined;
}

async function writeFileSafe(file: string, contents: string) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, contents);
}

function getRoute(
  appDirectory: string,
  routes: RouteManifest,
  file: string
): ConfigRoute | undefined {
  let routePath = normalizePath(path.relative(appDirectory, file));
  let route = Object.values(routes).find(
    (r) => normalizePath(r.file) === routePath
  );
  return route;
}

const getHash = (source: BinaryLike, maxLength?: number): string => {
  const hash = createHash("sha256").update(source).digest("hex");
  return typeof maxLength === "number" ? hash.slice(0, maxLength) : hash;
};

const BUILD_CLIENT_ROUTE_QUERY_STRING = "?__remix-build-client-route";

const resolveChunk = (
  ctx: { rootDirectory: string },
  viteManifest: Vite.Manifest,
  absoluteFilePath: string
) => {
  const rootRelativeFilePath = normalizePath(
    path.relative(ctx.rootDirectory, absoluteFilePath)
  );
  const entryChunk =
    viteManifest[rootRelativeFilePath + BUILD_CLIENT_ROUTE_QUERY_STRING] ??
    viteManifest[rootRelativeFilePath];

  if (!entryChunk) {
    const knownManifestKeys = Object.keys(viteManifest)
      .map((key) => `"${key}"`)
      .join(", ");
    throw new Error(
      `No manifest entry found for "${rootRelativeFilePath}". Known manifest keys: ${knownManifestKeys}`
    );
  }

  return entryChunk;
};

function getReactRouterManifestBuildAssets(
  ctx: { basename: string },
  viteManifest: Vite.Manifest,
  entryFilePath: string,
  prependedAssetFilePaths: string[] = []
): ReactRouterManifest["entry"] & { css: string[] } {
  const entryChunk = resolveChunk(
    reactRouterViteContext,
    viteManifest,
    entryFilePath
  );

  // This is here to support prepending client entry assets to the root route
  const prependedAssetChunks = prependedAssetFilePaths.map((filePath) =>
    resolveChunk(reactRouterViteContext, viteManifest, filePath)
  );

  const chunks = resolveDependantChunks(viteManifest, [
    ...prependedAssetChunks,
    entryChunk,
  ]);

  return {
    module: `${ctx.basename}${entryChunk.file}`,
    imports:
      dedupe(chunks.flatMap((e) => e.imports ?? [])).map((imported) => {
        return `${ctx.basename}${viteManifest[imported].file}`;
      }) ?? [],
    css:
      dedupe(chunks.flatMap((e) => e.css ?? [])).map((href) => {
        return `${ctx.basename}${href}`;
      }) ?? [],
  };
}

function resolveDependantChunks(
  viteManifest: Vite.Manifest,
  entryChunks: Vite.ManifestChunk[]
): Vite.ManifestChunk[] {
  const chunks = new Set<Vite.ManifestChunk>();

  function walk(chunk: Vite.ManifestChunk) {
    if (chunks.has(chunk)) {
      return;
    }

    if (chunk.imports) {
      for (const importKey of chunk.imports) {
        walk(viteManifest[importKey]);
      }
    }

    chunks.add(chunk);
  }

  for (const entryChunk of entryChunks) {
    walk(entryChunk);
  }

  return Array.from(chunks);
}

function dedupe<T>(array: T[]): T[] {
  return [...new Set(array)];
}
