// Check all buffer sizes in tests
function checkSize(name, bufferData, expectedSize) {
    const actualSize = Buffer.from(bufferData).length;
    console.log(`${name}: Expected ${expectedSize}, Actual ${actualSize} ${actualSize === expectedSize ? '✓' : '✗'}`);
}

console.log('=== Buffer Size Check ===');
checkSize('Hello World!\\n', 'Hello World!\n', 13);
checkSize('Error!\\n', 'Error!\n', 7);
checkSize('stdout', 'stdout', 6);
checkSize('stderr\\n', 'stderr\n', 7);
checkSize('test', 'test', 5);
checkSize('test', 'test', 4); // This will fail - it's incomplete by design
checkSize('test', 'test', 3); // This will fail - it's incomplete by design