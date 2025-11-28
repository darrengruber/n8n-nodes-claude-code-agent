// Debug test for parseDockerLogs
const fs = require('fs');
const path = require('path');

// Read the TypeScript file and extract the function
const logParserContent = fs.readFileSync('./nodes/RunContainer/utils/logParser.ts', 'utf8');

// Simple implementation for testing
const LogStreamType = {
    STDOUT: 1,
    STDERR: 2
};

function parseDockerLogs(logsBuffer) {
    const entries = [];
    let offset = 0;

    while (offset < logsBuffer.length) {
        // Check if we have enough bytes for a header
        if (offset + 8 > logsBuffer.length) {
            break;
        }

        // Parse header
        const streamType = logsBuffer[offset];
        const size = logsBuffer.readUInt32BE(offset + 4);

        // Validate stream type
        if (streamType !== LogStreamType.STDOUT && streamType !== LogStreamType.STDERR) {
            break;
        }

        // Check if we have enough bytes for the data
        const dataStart = offset + 8;
        const dataEnd = dataStart + size;

        if (dataEnd > logsBuffer.length) {
            break;
        }

        // Extract data
        const data = logsBuffer.slice(dataStart, dataEnd);
        // Remove control characters but preserve essential whitespace (tab, LF, CR)
        const text = data.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        entries.push({
            stream: streamType,
            data,
            text,
            timestamp: new Date()
        });

        // Move to next entry
        offset = dataEnd;
    }

    return entries;
}

// Test cases
console.log('=== Test Case 1: Success ===');
const buffer1 = Buffer.concat([
    Buffer.from([1, 0, 0, 0, 0, 0, 0, 7]), // Header: stdout, 7 bytes
    Buffer.from('Success\n') // Data (8 bytes!)
]);

console.log('Provided data length:', Buffer.from('Success\n').length);
console.log('Header says:', 7, 'bytes');

const result1 = parseDockerLogs(buffer1);
console.log('Result text:', JSON.stringify(result1[0]?.text));
console.log('Result data length:', result1[0]?.data.length);
console.log('');

console.log('=== Test Case 2: Warning ===');
const buffer2 = Buffer.concat([
    Buffer.from([2, 0, 0, 0, 0, 0, 0, 6]), // Header: stderr, 6 bytes
    Buffer.from('Warning\n') // Data (8 bytes!)
]);

console.log('Provided data length:', Buffer.from('Warning\n').length);
console.log('Header says:', 6, 'bytes');

const result2 = parseDockerLogs(buffer2);
console.log('Result text:', JSON.stringify(result2[0]?.text));
console.log('Result data length:', result2[0]?.data.length);
console.log('');

console.log('=== Test Case 3: Error ===');
const buffer3 = Buffer.concat([
    Buffer.from([2, 0, 0, 0, 0, 0, 0, 11]), // Header: stderr, 11 bytes
    Buffer.from('Error: failed\n') // Data (14 bytes!)
]);

console.log('Provided data length:', Buffer.from('Error: failed\n').length);
console.log('Header says:', 11, 'bytes');

const result3 = parseDockerLogs(buffer3);
console.log('Result text:', JSON.stringify(result3[0]?.text));
console.log('Result data length:', result3[0]?.data.length);
console.log('');

console.log('=== Manually create correct buffers ===');
const correctBuffer1 = Buffer.concat([
    Buffer.from([1, 0, 0, 0, 0, 0, 0, 8]), // Header: stdout, 8 bytes
    Buffer.from('Success\n') // Data (8 bytes)
]);

const correctResult1 = parseDockerLogs(correctBuffer1);
console.log('Correct Success text:', JSON.stringify(correctResult1[0]?.text));

const correctBuffer2 = Buffer.concat([
    Buffer.from([2, 0, 0, 0, 0, 0, 0, 8]), // Header: stderr, 8 bytes
    Buffer.from('Warning\n') // Data (8 bytes)
]);

const correctResult2 = parseDockerLogs(correctBuffer2);
console.log('Correct Warning text:', JSON.stringify(correctResult2[0]?.text));

const correctBuffer3 = Buffer.concat([
    Buffer.from([2, 0, 0, 0, 0, 0, 0, 14]), // Header: stderr, 14 bytes
    Buffer.from('Error: failed\n') // Data (14 bytes)
]);

const correctResult3 = parseDockerLogs(correctBuffer3);
console.log('Correct Error text:', JSON.stringify(correctResult3[0]?.text));