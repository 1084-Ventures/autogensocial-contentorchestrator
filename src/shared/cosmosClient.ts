import { CosmosClient } from "@azure/cosmos";

const connectionString = process.env["COSMOS_DB_CONNECTION_STRING"];
if (!connectionString) {
  throw new Error("COSMOS_DB_CONNECTION_STRING environment variable is not set.");
}

export const cosmosClient = new CosmosClient(connectionString);