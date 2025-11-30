import {
    parseCommand,
    validateCommandArgs,
    buildCommandString
} from '../../utils/commandParser';

describe('RunContainer > utils > commandParser', () => {
    describe('parseCommand', () => {
        it('should parse simple commands', () => {
            expect(parseCommand('echo hello')).toEqual(['echo', 'hello']);
            expect(parseCommand('ls -la')).toEqual(['ls', '-la']);
            expect(parseCommand('python script.py --verbose')).toEqual(['python', 'script.py', '--verbose']);
            expect(parseCommand('npm run build')).toEqual(['npm', 'run', 'build']);
        });

        it('should handle quoted arguments', () => {
            expect(parseCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
            expect(parseCommand('git commit -m "fix: resolve bug"')).toEqual(['git', 'commit', '-m', 'fix: resolve bug']);
            expect(parseCommand('echo "path with spaces/file.txt"')).toEqual(['echo', 'path with spaces/file.txt']);
            expect(parseCommand('node -e "console.log(\\"Hello\\")"')).toEqual(['node', '-e', 'console.log("Hello")']);
        });

        it('should handle escaped quotes', () => {
            expect(parseCommand('echo "hello \\"world\\""')).toEqual(['echo', 'hello "world"']);
            expect(parseCommand('echo "C:\\\\Program Files"')).toEqual(['echo', 'C:\\Program Files']);
            expect(parseCommand("echo \"Don't do this\"")).toEqual(['echo', "Don't do this"]);
            expect(parseCommand('grep "pattern\\|other" file.txt')).toEqual(['grep', 'pattern|other', 'file.txt']);
        });

        it('should handle empty commands', () => {
            expect(parseCommand('')).toEqual([]);
            expect(parseCommand('   ')).toEqual([]);
            expect(parseCommand('\t')).toEqual([]);
        });

        it('should handle commands with multiple spaces', () => {
            expect(parseCommand('echo    hello')).toEqual(['echo', 'hello']);
            expect(parseCommand('  ls   -la   ')).toEqual(['ls', '-la']);
            expect(parseCommand('git   status   --porcelain')).toEqual(['git', 'status', '--porcelain']);
        });

        it('should handle complex arguments with mixed quotes', () => {
            const cmd = 'python -c "import json; print(json.dumps({\\"key\\": \\"value\\"}))"';
            expect(parseCommand(cmd)).toEqual([
                'python',
                '-c',
                'import json; print(json.dumps({"key": "value"}))'
            ]);
        });

        it('should handle single quotes inside double quotes', () => {
            expect(parseCommand('echo "It\'s a test"')).toEqual(['echo', "It's a test"]);
            expect(parseCommand('echo "Don\'t forget this"')).toEqual(['echo', "Don't forget this"]);
        });

        it('should handle commands with special characters', () => {
            expect(parseCommand('echo $PATH')).toEqual(['echo', '$PATH']);
            expect(parseCommand('find . -name "*.js"')).toEqual(['find', '.', '-name', '*.js']);
            expect(parseCommand('echo "line1\\nline2"')).toEqual(['echo', 'line1\nline2']);
        });

        it('should handle commands with numbers and flags', () => {
            expect(parseCommand('sleep 5')).toEqual(['sleep', '5']);
            expect(parseCommand('curl -X POST -d "data=test" http://example.com')).toEqual([
                'curl', '-X', 'POST', '-d', 'data=test', 'http://example.com'
            ]);
        });
    });

    describe('validateCommandArgs', () => {
        it('should validate valid arguments', () => {
            const validArgs = ['echo', 'hello', 'world'];
            expect(validateCommandArgs(validArgs)).toEqual(validArgs);
        });

        it('should filter out invalid arguments', () => {
            const mixedArgs = ['echo', '', 'world', null as any, undefined as any, 'test'];
            expect(validateCommandArgs(mixedArgs)).toEqual(['echo', 'world', 'test']);
        });

        it('should handle empty arrays', () => {
            expect(validateCommandArgs([])).toEqual([]);
        });

        it('should handle arrays with only invalid arguments', () => {
            const invalidArgs = ['', null as any, undefined as any];
            expect(validateCommandArgs(invalidArgs)).toEqual([]);
        });

        it('should preserve whitespace-only strings that pass validation', () => {
            // This tests edge case - strings that are just whitespace should be filtered out
            const whitespaceArgs = ['echo', '  ', 'test', '\t', 'value'];
            expect(validateCommandArgs(whitespaceArgs)).toEqual(['echo', 'test', 'value']);
        });
    });

    describe('buildCommandString', () => {
        it('should build command string from array', () => {
            expect(buildCommandString(['echo', 'hello', 'world'])).toBe('echo hello world');
            expect(buildCommandString(['ls', '-la', '/home'])).toBe('ls -la /home');
            expect(buildCommandString(['npm', 'run', 'test'])).toBe('npm run test');
        });

        it('should quote arguments with spaces', () => {
            expect(buildCommandString(['hello world'])).toBe('"hello world"');
            expect(buildCommandString(['git', 'commit', '-m', 'fix bug'])).toBe('git commit -m "fix bug"');
            expect(buildCommandString(['cp', 'source file', 'destination'])).toBe('cp "source file" destination');
        });

        it('should escape quotes in arguments', () => {
            expect(buildCommandString(['hello "world"'])).toBe('"hello \\"world\\""');
            expect(buildCommandString(['grep', '"pattern"'])).toBe('grep "\\"pattern\\""');
        });

        it('should handle empty arrays', () => {
            expect(buildCommandString([])).toBe('');
        });

        it('should handle single arguments', () => {
            expect(buildCommandString(['ls'])).toBe('ls');
            expect(buildCommandString(['hello world'])).toBe('"hello world"');
        });

        it('should handle arguments with special characters', () => {
            expect(buildCommandString(['echo', '$PATH'])).toBe('echo $PATH');
            expect(buildCommandString(['find', '.', '-name', '*.js'])).toBe('find . -name "*.js"');
        });

        it('should handle mixed quotes and spaces', () => {
            expect(buildCommandString(['hello "world" test'])).toBe('"hello \\"world\\" test"');
        });
    });
});