  import {
      IExecuteFunctions,
      INodeExecutionData,
      INodeType,
      INodeTypeDescription,
      NodeOperationError,
      jsonParse,
  } from 'n8n-workflow';
  import * as fs from 'fs';
  import * as path from 'path';
  import * as os from 'os';
  import Docker from 'dockerode';
  
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
  
                  const result = await runContainer(socketPath, image, entrypoint, command, envVars);
  
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
      entrypoint: string,
      command: string,
      envVars: string[],
  ): Promise<{ stdout: Buffer; stderr: Buffer; statusCode: number }> {
      // Parse command into array (split by spaces, respecting quotes)
      // Handle both quoted and unquoted arguments, including escaped quotes
      const parseCommand = (cmd: string): string[] => {
          if (!cmd) return [];
          const parts: string[] = [];
          let current = '';
          let inQuotes = false;
          let i = 0;
          
          while (i < cmd.length) {
              const char = cmd[i];
              
              // Handle escaped characters (including escaped quotes)
              if (char === '\\' && i + 1 < cmd.length) {
                  const nextChar = cmd[i + 1];
                  if (nextChar === '"' || nextChar === '\\') {
                      // Include the escaped character literally
                      current += nextChar;
                      i += 2;
                      continue;
                  }
              }
              
              // Handle quote toggling (but not escaped quotes)
              if (char === '"' && (i === 0 || cmd[i - 1] !== '\\')) {
                  inQuotes = !inQuotes;
                  i++;
                  continue;
              }
              
              // Handle space outside of quotes
              if (char === ' ' && !inQuotes) {
                  if (current.trim()) {
                      parts.push(current.trim());
                      current = '';
                  }
                  i++;
                  continue;
              }
              
              // Regular character
              current += char;
              i++;
          }
          
          // Add the last part if there's anything left
          if (current.trim()) {
              parts.push(current.trim());
          }
          
          return parts;
      };
      
      const cmdArray = parseCommand(command);
  
      // Initialize Docker client
      const docker = new Docker({ socketPath });
  
      // 1. Check if image exists, pull if needed
      let imageExists = false;
      try {
          const dockerImage = docker.getImage(image);
          await dockerImage.inspect();
          imageExists = true;
      } catch (error) {
          // Image doesn't exist locally
          imageExists = false;
      }

      if (!imageExists) {
          // Always pull the image if it doesn't exist
          await new Promise<void>((resolve, reject) => {
              docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream | null) => {
                  if (err) {
                      reject(new Error(`Failed to pull image ${image}: ${err.message}`));
                      return;
                  }
                  
                  if (!stream) {
                      reject(new Error(`Failed to pull image ${image}: No stream returned`));
                      return;
                  }
                  
                  docker.modem.followProgress(stream, (err: Error | null) => {
                      if (err) {
                          reject(new Error(`Failed to pull image ${image}: ${err.message}`));
                      } else {
                          resolve();
                      }
                  });
              });
          });
      }
  
      // 2. Create Container
      const createOptions: any = {
          Image: image,
          Env: envVars,
          Tty: false,
          AttachStdout: true,
          AttachStderr: true,
      };

      // Set entrypoint if provided
      if (entrypoint) {
          createOptions.Entrypoint = parseCommand(entrypoint);
      }

      // Set command if provided
      if (cmdArray.length > 0) {
          createOptions.Cmd = cmdArray;
      }
      
      const container = await docker.createContainer(createOptions);
  
      // 3. Start Container
      await container.start();
  
      // 4. Wait for Container
      const waitResult = await container.wait();
      const statusCode = waitResult.StatusCode;
  
      // 5. Get Logs
      const logsBuffer = await container.logs({
          stdout: true,
          stderr: true,
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
      await container.remove({ v: true });
  
      return { stdout, stderr, statusCode };
  }
