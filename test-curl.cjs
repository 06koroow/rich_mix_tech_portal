const { execSync } = require('child_process');

function runCurl(url) {
  const cmd = `curl -s -i --request GET \\
    --url '${url}' \\
    --header 'Accept: application/json' \\
    --header 'Authorization: Basic b3NjYXIua29yb25rYUByaWNobWl4Lm9yZy51azpNMGRlaHVyc3QhOTk0' \\
    --header 'X-API-KEY: 5fd9bd7f5b9748a5efacd8606964d6b1'`;
  try {
    const output = execSync(cmd).toString();
    console.log(`[${url}] \\n${output.substring(0, 150)}...`);
  } catch(e) {
    console.log(`[${url}] ERROR`);
  }
}

runCurl('https://richmix.artifaxevent.com/api/public/v1/events');
runCurl('https://richmix.artifaxevent.com/api/events');
runCurl('https://richmix.artifaxevent.com/api/arrangements/events');
runCurl('https://richmix.artifaxevent.com/api/arrangements/event');
