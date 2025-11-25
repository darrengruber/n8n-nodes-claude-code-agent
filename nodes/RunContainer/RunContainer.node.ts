  import {
      IExecuteFunctions,
      INodeExecutionData,
      INodeType,
      INodeTypeDescription,
      NodeOperationError,
      jsonParse,
  } from 'n8n-workflow';
  import * as http from 'http';
  import * as fs from 'fs';
  import * as path from 'path';
  import * as os from 'os';
  
  import { mainProperties } from './Description';
  
  export class RunContainer implements INodeType {
      description: INodeTypeDescription = {
          displayName: 'Run Container',
          name: 'runContainer',
          icon: { light: 'file:img/runContainer.svg', dark: 'file:img/runContainer.dark.svg' },
          group: ['transform'],
          version: 1,
          description: 'Runs a Docker container',
          defaults: {
              name: 'Run Container',
          },
          inputs: ['main'],
          outputs: ['main'],
          properties: mainProperties,
          usableAsTool: true,
      };
  
      async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
          const items = this.getInputData();
          const returnData: INodeExecutionData[] = [];
  
          for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
              try {
                  let socketPath = this.getNodeParameter('socketPath', itemIndex) as string;
                  
                  // Auto-detect Docker socket if default path doesn't exist
                  if (socketPath === '/var/run/docker.sock' && !fs.existsSync(socketPath)) {
                      // Try Colima path on macOS
                      if (os.platform() === 'darwin') {
                          const colimaPath = path.join(os.homedir(), '.colima', 'default', 'docker.sock');
                          if (fs.existsSync(colimaPath)) {
                              socketPath = colimaPath;
                          }
                      }
                  }
                  const image = this.getNodeParameter('image', itemIndex) as string;
                  const pullImage = this.getNodeParameter('pullImage', itemIndex, true) as boolean;
                  const entrypoint = this.getNodeParameter('entrypoint', itemIndex, '') as string;
                  const command = this.getNodeParameter('command', itemIndex, '') as string;
                  const sendEnv = this.getNodeParameter('sendEnv', itemIndex, false) as boolean;
  
                  let envVars: string[] = [];
  
                  if (sendEnv) {
                      const specifyEnv = this.getNodeParameter('specifyEnv', itemIndex, 'keypair') as string;
  
                      if (specifyEnv === 'json') {
                          const jsonEnv = this.getNodeParameter('jsonEnv', itemIndex, '') as string;
                          try {
                              const envData = jsonParse(jsonEnv) as Record<string, any>;
                              for (const [key, val] of Object.entries(envData)) {
                                  envVars.push(`${key}=${val}`);
                              }
                          } catch (error) {
                              throw new NodeOperationError(
                                  this.getNode(),
                                  `Failed to parse JSON environment variables: ${error.message}`,
                                  { itemIndex },
                              );
                          }
                      } else if (specifyEnv === 'keypair') {
                          const envCollection = this.getNodeParameter('parametersEnv', itemIndex, {}) as {
                              values: Array<{ name: string; value?: string }>;
                          };
  
                          for (const envVar of envCollection.values || []) {
                              if (envVar.name && envVar.value !== undefined) {
                                  envVars.push(`${envVar.name}=${envVar.value}`);
                              }
                          }
                      } else if (specifyEnv === 'model') {
                          const modelInput = this.getNodeParameter('modelInput', itemIndex) as string | Record<string, any>;
                          const envData = typeof modelInput === 'string' ? jsonParse(modelInput) : modelInput;
                          if (typeof envData === 'object' && envData !== null) {
                              for (const [key, val] of Object.entries(envData)) {
                                  envVars.push(`${key}=${val}`);
                              }
                          }
                      }
                  }
  
                  if (!image) {
                      throw new NodeOperationError(
                          this.getNode(),
                          'The "Image" parameter is required',
                          { itemIndex },
                      );
                  }
  
                  const result = await runContainer(socketPath, image, pullImage, entrypoint, command, envVars);
  
                  returnData.push({
                      json: {
                          stdout: result.stdout.toString(),
                          stderr: result.stderr.toString(),
                          exitCode: result.statusCode,
                      },
                      pairedItem: {
                          item: itemIndex,
                      },
                  });
              } catch (error) {
                  if (this.continueOnFail()) {
                      returnData.push({
                          json: {
                              error: error.message,
                          },
                          pairedItem: {
                              item: itemIndex,
                          },
                      });
                  } else {
                      throw new NodeOperationError(this.getNode(), error, {
                          itemIndex,
                      });
                  }
              }
          }
  
          return [returnData];
      }
  }
  
  async function runContainer(
      socketPath: string,
      image: string,
      pullImage: boolean,
      entrypoint: string,
      command: string,
      envVars: string[],
  ): Promise<{ stdout: Buffer; stderr: Buffer; statusCode: number }> {
      // Parse command into array (split by spaces, respecting quotes)
      // Handle both quoted and unquoted arguments
      const parseCommand = (cmd: string): string[] => {
          if (!cmd) return [];
          // Simple split that handles quoted strings
          const parts: string[] = [];
          let current = '';
          let inQuotes = false;
          for (let i = 0; i < cmd.length; i++) {
              const char = cmd[i];
              if (char === '"' && (i === 0 || cmd[i - 1] !== '\\')) {
                  inQuotes = !inQuotes;
              } else if (char === ' ' && !inQuotes) {
                  if (current.trim()) {
                      parts.push(current.trim());
                      current = '';
                  }
              } else {
                  current += char;
              }
          }
          if (current.trim()) {
              parts.push(current.trim());
          }
          return parts;
      };
      
      const cmdArray = parseCommand(command);
  
      // Helper to make Docker API requests
      const dockerRequest = async (method: string, path: string, body?: any): Promise<any> => {
          return new Promise((resolve, reject) => {
              const options: http.RequestOptions = {
                  socketPath,
                  path,
                  method,
                  headers: {
                      'Content-Type': 'application/json',
                  },
              };
  
              const req = http.request(options, (res) => {
                  const chunks: Buffer[] = [];
                  res.on('data', (chunk) => chunks.push(chunk));
                  res.on('end', () => {
                      const buffer = Buffer.concat(chunks);
                      const responseBody = buffer.toString();
  
                      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                          try {
                              if (responseBody) {
                                  resolve(JSON.parse(responseBody));
                              } else {
                                  resolve({});
                              }
                          } catch (e) {
                              // If not JSON (e.g. logs), return string
                              resolve(responseBody);
                          }
                      } else {
                          reject(new Error(`Docker API Error: ${res.statusCode} - ${responseBody} `));
                      }
                  });
              });
  
              req.on('error', (e) => reject(e));
  
              if (body) {
                  req.write(JSON.stringify(body));
              }
              req.end();
          });
      };
  
      // 1. Check if image exists, pull if needed
      let imageExists = false;
      try {
          await dockerRequest('GET', `/images/${image}/json`);
          imageExists = true;
      } catch (error) {
          // Image doesn't exist locally
          imageExists = false;
      }

      if (!imageExists) {
          if (pullImage) {
              // Pull the image
              await new Promise<void>((resolve, reject) => {
                  const options: http.RequestOptions = {
                      socketPath,
                      path: `/images/create?fromImage=${encodeURIComponent(image)}`,
                      method: 'POST',
                  };
                  const req = http.request(options, (res) => {
                      let hasError = false;
                      res.on('data', (chunk) => {
                          // Docker API streams JSON lines for pull progress
                          // Check for error messages in the stream
                          const text = chunk.toString();
                          if (text.includes('"error"') || text.includes('"errorDetail"')) {
                              hasError = true;
                          }
                      });
                      res.on('end', () => {
                          if (hasError && res.statusCode && res.statusCode >= 400) {
                              reject(new Error(`Failed to pull image ${image}. Check if the image name is correct and you have access to the registry.`));
                          } else {
                              resolve();
                          }
                      });
                  });
                  req.on('error', (err) => {
                      reject(new Error(`Failed to pull image ${image}: ${err.message}`));
                  });
                  req.end();
              });
          } else {
              throw new Error(`Image ${image} not found locally and pullImage is disabled. Enable "Pull Image If Not Present" to automatically pull the image.`);
          }
      }
  
      // 2. Create Container
      const createBody: any = {
          Image: image,
          Env: envVars,
          Tty: false,
      };

      // Set entrypoint if provided
      if (entrypoint) {
          createBody.Entrypoint = parseCommand(entrypoint);
      }

      // Set command if provided
      if (cmdArray.length > 0) {
          createBody.Cmd = cmdArray;
      }
      const createRes = await dockerRequest('POST', '/containers/create', createBody);
      const containerId = createRes.Id;
  
      // 3. Start Container
      await dockerRequest('POST', `/containers/${containerId}/start`);
  
      // 4. Wait for Container
      const waitRes = await dockerRequest('POST', `/containers/${containerId}/wait`);
      const statusCode = waitRes.StatusCode;
  
      // 5. Get Logs
      const logsBuffer = await new Promise<Buffer>((resolve, reject) => {
          const options: http.RequestOptions = {
              socketPath,
              path: `/containers/${containerId}/logs?stdout=1&stderr=1&stderr=1&logs=1`,
              method: 'GET',
          };
          const req = http.request(options, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk) => chunks.push(chunk));
              res.on('end', () => resolve(Buffer.concat(chunks)));
          });
          req.on('error', reject);
          req.end();
      });
  
      // Parse Docker logs (multiplexed)
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
  
      let offset = 0;
      while (offset < logsBuffer.length) {
          const type = logsBuffer[offset]; // 1 = stdout, 2 = stderr
          const size = logsBuffer.readUInt32BE(offset + 4);
          const content = logsBuffer.slice(offset + 8, offset + 8 + size);
  
          if (type === 1) {
              stdout = Buffer.concat([stdout, content]);
          } else if (type === 2) {
              stderr = Buffer.concat([stderr, content]);
          }
  
          offset += 8 + size;
      }
  
      // 6. Remove Container
      await dockerRequest('DELETE', `/containers/${containerId}?v=1`);
  
      return { stdout, stderr, statusCode };
  }
