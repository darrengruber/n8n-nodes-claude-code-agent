import { validateDockerImageName } from '../GenericFunctions';

describe('validateDockerImageName', () => {
    describe('valid image names', () => {
        it('should accept simple image names', () => {
            expect(validateDockerImageName('ubuntu').valid).toBe(true);
            expect(validateDockerImageName('alpine').valid).toBe(true);
            expect(validateDockerImageName('node').valid).toBe(true);
        });

        it('should accept image names with tags', () => {
            expect(validateDockerImageName('ubuntu:latest').valid).toBe(true);
            expect(validateDockerImageName('ubuntu:22.04').valid).toBe(true);
            expect(validateDockerImageName('node:20-alpine').valid).toBe(true);
            expect(validateDockerImageName('python:3.11.5').valid).toBe(true);
        });

        it('should accept image names with registry', () => {
            expect(validateDockerImageName('docker.io/library/ubuntu').valid).toBe(true);
            expect(validateDockerImageName('gcr.io/project/image').valid).toBe(true);
            expect(validateDockerImageName('ghcr.io/user/repo').valid).toBe(true);
        });

        it('should accept image names with registry  and tag', () => {
            expect(validateDockerImageName('docker.io/library/ubuntu:latest').valid).toBe(true);
            expect(validateDockerImageName('gcr.io/project/image:v1.0.0').valid).toBe(true);
        });

        it('should accept localhost registries', () => {
            expect(validateDockerImageName('localhost:5000/myimage').valid).toBe(true);
            expect(validateDockerImageName('localhost:5000/myimage:latest').valid).toBe(true);
        });

        it('should accept image names with organization', () => {
            expect(validateDockerImageName('library/ubuntu').valid).toBe(true);
            expect(validateDockerImageName('my-org/my-image').valid).toBe(true);
        });
    });

    describe('invalid image names', () => {
        it('should reject empty names', () => {
            expect(validateDockerImageName('').valid).toBe(false);
            expect(validateDockerImageName('   ').valid).toBe(false);
        });

        it('should reject names with invalid characters', () => {
            expect(validateDockerImageName('image@tag').valid).toBe(false); // @ without sha256:
            expect(validateDockerImageName('image name').valid).toBe(false); // space
            expect(validateDockerImageName('image!tag').valid).toBe(false); // !
        });

        it('should reject tags that are too long', () => {
            const longTag = 'a'.repeat(129);
            expect(validateDockerImageName(`ubuntu:${longTag}`).valid).toBe(false);
        });
    });

    describe('error messages', () => {
        it('should provide helpful error for empty name', () => {
            const result = validateDockerImageName('');
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Image name cannot be empty');
        });
    });
});
