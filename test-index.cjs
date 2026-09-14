const { execSync } = require('child_process');

function runCurl(url) {
  const cmd = `curl -s -i --request GET \\
    --url '${url}' \\
    --header 'Accept: application/json' \\
    --header 'Authorization: Basic b3NjYXIua29yb25rYUByaWNobWl4Lm9yZy51azpNMGRlaHVyc3QhOTk0' \\
    --header 'X-API-KEY: 5fd9bd7f5b9748a5efacd8606964d6b1'`;
  try {
    const output = execSync(cmd).toString();
    console.log(`[${url}] \\n${output.split('\\n')[0]} - ${output.split('\\n\\r\\n')[1] ? output.split('\\n\\r\\n')[1].substring(0, 50) : output}`);
  } catch(e) {}
}

runCurl('https://richmix.artifaxevent.com/api/public/v1/events/index');
runCurl('https://richmix.artifaxevent.com/api/public/v1/arrangement/index');
runCurl('https://richmix.artifaxevent.com/api/arrangements/index');
runCurl('https://richmix.artifaxevent.com/api/arrangements/event/index');
