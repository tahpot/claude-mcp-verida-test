#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const CONFIG = {
  verida: {
    schemas: <Record<string, string>>{
      DATA_CONNECTIONS:
        "https://vault.schemas.verida.io/data-connections/connection/v0.3.0/schema.json",
      SYNC_POSITION:
        "https://vault.schemas.verida.io/data-connections/sync-position/v0.2.0/schema.json",
      SYNC_LOG:
        "https://vault.schemas.verida.io/data-connections/activity-log/v0.2.0/schema.json",
      FOLLOWING:
        "https://common.schemas.verida.io/social/following/v0.1.0/schema.json",
      POST: "https://common.schemas.verida.io/social/post/v0.1.0/schema.json",
      EMAIL: "https://common.schemas.verida.io/social/email/v0.1.0/schema.json",
      FAVOURITE:
        "https://common.schemas.verida.io/favourite/v0.1.0/schema.json",
      FILE: "https://common.schemas.verida.io/file/v0.1.0/schema.json",
      CHAT_GROUP:
        "https://common.schemas.verida.io/social/chat/group/v0.1.0/schema.json",
      CHAT_MESSAGE:
        "https://common.schemas.verida.io/social/chat/message/v0.1.0/schema.json",
      CALENDAR:
        "https://common.schemas.verida.io/social/calendar/v0.1.0/schema.json",
      EVENT: "https://common.schemas.verida.io/social/event/v0.1.0/schema.json",
    },
  },
};

import Axios from "axios";
import { Utils } from "./utils.js";

// const dotenv = require("dotenv")
// dotenv.config();
// const PRIVATE_KEY = process.env.PRIVATE_KEY as string;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Please provide a private key as a command-line argument");
  process.exit(1);
}

const PRIVATE_KEY = args[0];

const server = new Server(
  {
    name: "verida/user-data",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

const resourceBaseUrl = `verida://datastore/`;
const SCHEMA_PATH = "schema";

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const schemas: Record<string, string> = CONFIG.verida.schemas;

  return {
    resources: Object.keys(schemas).map((schema) => ({
      uri: new URL(`${schema}/${SCHEMA_PATH}`, resourceBaseUrl).href,
      mimeType: "application/json",
      name: `"${schema}" database schema`,
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resourceUrl = new URL(request.params.uri);
  let pathComponents;

  try {
    pathComponents = resourceUrl.pathname.split("/");

    // pathComponents.pop()
    const resourceType = pathComponents.pop() as string;
    const schemaName = pathComponents.pop() as string;
    if (resourceType !== SCHEMA_PATH) {
      throw new Error(`Invalid resource URI: ${schemaName} ${resourceType}`);
    }

    const schemaUrl = CONFIG.verida.schemas[schemaName];
    const response = await Axios.get(schemaUrl);

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(response.data),
        },
      ],
    };
  } catch (err: any) {
    throw new Error(`${err.message}`);
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query",
        description: "Run a read-only CouchDB query using a known schema",
        inputSchema: {
          type: "object",
          properties: {
            schemaName: { type: "string" },
            filter: { type: "object" },
            limit: { type: "number" },
            skip: { type: "number" },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "query") {
    const filter = request.params.arguments?.filter as object;
    const schemaName = request.params.arguments?.schemaName as string;
    const limit = request.params.arguments?.limit as number;
    const skip = request.params.arguments?.skip as number;

    try {
      const { context } = await Utils.getNetworkConnectionFromPrivateKey(
        PRIVATE_KEY
      );

      const schema = CONFIG.verida.schemas[schemaName];
      const ds = await context.openDatastore(schema, {});

      const selector = filter;
      const options = {};
      const items = await ds.getMany(selector, options);
      const db = await ds.getDb();
      const pouchDb = await db.getDb();
      const info = await pouchDb.info();

      // Build total number of rows, excluding special CouchDB index rows
      // Note: total_rows includes the special _id index which isn't included in rows, hence the + 1
      const indexInfo = await pouchDb.getIndexes();
      const dbRows = info.doc_count - indexInfo.total_rows + 1;

      const result = {
        items,
        limit,
        skip,
        dbRows,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (error: any) {
      let message = error.message;
      if (error.message.match("invalid encoding")) {
        message = "Invalid encoding (check permissions header)";
      }

      throw new Error(
        `Tool error: ${request.params.name} ${error.message} ${schemaName}`
      );
    }
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

console.log("running server");

runServer().catch(console.error);
