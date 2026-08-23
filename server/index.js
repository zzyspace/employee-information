import { createApp } from "./app.js";
import { serverHost, serverPort } from "./config.js";

const app = createApp();
app.listen(serverPort, serverHost, () => {
  console.log(
    `employee-information server listening on http://${serverHost}:${serverPort}/staff/fuzzy`
  );
});
