const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function testExec() {
  try {
    console.log('Testing exec...');
    const { stdout, stderr } = await execAsync('echo "Hello World"');
    console.log('Success!');
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
  } catch (error) {
    console.error('Failed:', error.message);
    console.error('Full error:', error);
  }
}

testExec();
