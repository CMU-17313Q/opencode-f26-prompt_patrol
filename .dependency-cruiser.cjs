// Enforces the package layering described in AGENTS.md:
// Schema -> Core and Protocol -> Server, and Client runtime code may use
// Schema and Protocol but never Core or Server.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "client-not-to-core-or-server",
      comment: "Client runtime code may depend on Schema and Protocol, never Core or Server (AGENTS.md).",
      severity: "error",
      from: { path: "^packages/client/src/" },
      to: { path: "^packages/(core|server)/" },
    },
    {
      name: "core-and-protocol-not-to-server",
      comment: "Server sits on top of Core and Protocol, so they must not import it.",
      severity: "error",
      from: { path: "^packages/(core|protocol)/src/" },
      to: { path: "^packages/server/" },
    },
    {
      name: "schema-not-to-other-layers",
      comment: "Schema is the bottom layer and must not import Core, Protocol, Server or Client.",
      severity: "error",
      from: { path: "^packages/schema/src/" },
      to: { path: "^packages/(core|protocol|server|client)/" },
    },
    {
      name: "no-circular",
      comment:
        "Circular imports are reported but don't fail the check yet. A file importing itself is skipped, since modules here re-export themselves (export * as Foo from './foo').",
      severity: "warn",
      from: { path: "(.+)" },
      to: { circular: true, pathNot: "^$1$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(test|node_modules|dist)/" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["bun", "import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
}
