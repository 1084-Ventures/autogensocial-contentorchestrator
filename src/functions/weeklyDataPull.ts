import { app, InvocationContext, Timer } from "@azure/functions";

export async function weeklyDataPull(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('Timer function processed request.');
}

app.timer('weeklyDataPull', {
    schedule: '0 */5 * * * *',
    handler: weeklyDataPull
});
