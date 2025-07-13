import { app, InvocationContext, Timer } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";
import { DateTime } from "luxon";
// @ts-ignore
import fetch from "node-fetch";

export async function checkSchedules(myTimer: Timer, context: InvocationContext): Promise<void> {
  context.log("checkSchedules function started");
  const connectionString = process.env.COSMOS_DB_CONNECTION_STRING!;
  const databaseId = process.env.COSMOS_DB_NAME!;
  const containerId = process.env.COSMOS_DB_CONTAINER_TEMPLATE!;

  context.log("Connecting to Cosmos DB", { databaseId, containerId });
  const client = new CosmosClient(connectionString);
  const container = client.database(databaseId).container(containerId);

  // Query all active templates
  context.log("Querying active templates from Cosmos DB...");
  const { resources: templates } = await container.items
    .query("SELECT * FROM c WHERE c.metadata.isActive = true")
    .fetchAll();
  context.log(`Found ${templates.length} active templates.`);

  const nowUtc = DateTime.utc();
  context.log("Current UTC time:", nowUtc.toISO());

  for (const template of templates) {
    context.log(`Processing template: ${template.id}`);
    const { daysOfWeek, timeSlots } = template.schedule;
    context.log(`  daysOfWeek: ${JSON.stringify(daysOfWeek)}, timeSlots: ${JSON.stringify(timeSlots)}`);
    for (const slot of timeSlots) {
      context.log(`    Checking slot: ${JSON.stringify(slot)}`);
      const localNow = nowUtc.setZone(slot.timezone);
      context.log(`    Local time in timezone (${slot.timezone}): ${localNow.toISO()}`);
      const lastExecutionTime = template.metadata.lastExecutionTime ? DateTime.fromISO(template.metadata.lastExecutionTime) : null;
      context.log(`    Last execution time: ${lastExecutionTime ? lastExecutionTime.toISO() : "never"}`);
      const isScheduledDay = daysOfWeek.includes(localNow.weekdayLong.toLowerCase());
      const isScheduledTime = localNow.hour === slot.hour && localNow.minute === slot.minute;
      const alreadyExecuted = lastExecutionTime && lastExecutionTime.hasSame(localNow, 'minute');
      context.log(`    isScheduledDay: ${isScheduledDay}, isScheduledTime: ${isScheduledTime}, alreadyExecuted: ${alreadyExecuted}`);

      if (isScheduledDay && isScheduledTime && !alreadyExecuted) {
        context.log(`    Triggering orchestration for template ${template.id}`);
        // Call orchestrateContent via HTTP POST using API_BASE_URL
        const apiBaseUrl = process.env.API_BASE_URL;
        if (!apiBaseUrl) {
          context.log("ERROR: API_BASE_URL environment variable is not set.");
        } else {
          const orchestrateUrl = `${apiBaseUrl}/orchestrate-content`;
          context.log(`    Calling orchestrateContent at ${orchestrateUrl} for brandId=${template.brandId}, templateId=${template.id}`);
          try {
            const response = await fetch(orchestrateUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ brandId: template.brandId, templateId: template.id })
            });
            context.log(`    orchestrateContent response: ${response.status} ${response.statusText}`);
            if (!response.ok) {
              context.log(`ERROR: Failed to trigger orchestrateContent: ${response.status} ${response.statusText}`);
            }
          } catch (err) {
            context.log("ERROR: Error calling orchestrateContent:", err);
          }
        }
        // Update lastExecutionTime in Cosmos DB
        template.metadata.lastExecutionTime = nowUtc.toISO();
        context.log(`    Updating lastExecutionTime for template ${template.id} to ${template.metadata.lastExecutionTime}`);
        await container.item(template.id, template.brandId).replace(template);
      } else {
        context.log(`    Not triggering orchestration for template ${template.id} (isScheduledDay: ${isScheduledDay}, isScheduledTime: ${isScheduledTime}, alreadyExecuted: ${alreadyExecuted})`);
      }
    }
  }
  context.log("checkSchedules function completed");
}

app.timer('checkSchedules', {
  schedule: '0 0,5,10,15,20,25,30,35,40,45,50,55 * * * *',
  handler: checkSchedules
});
