/**
 * 💻 TERMINAL TOOLS - Виртуальный MCP сервер для системы
 *
 * Модуль содержит инструменты для взаимодействия с системным окружением:
 * диагностика, сетевые утилиты, управление процессами и взаимодействие с пользователем.
 */

import path from 'path';
import fs from 'fs/promises';
import { execAsync, spawnAsync, spawnWithOutput, spawnBackground } from '../utils/processHelpers.js';
import { logInfo, logError, extractErrorDetails } from '../utils/logger.js';
import { getWorkspaceRoot, resolveWorkspacePath } from '../utils/workspaceUtils.js';

// 💻 ЭКСПОРТ ВСЕХ TERMINAL КОМАНД
export const terminalTools = [
  {
    name: "echo",
    description: "Возвращает переданное сообщение. Используется для проверки работоспособности MCP сервера и тестирования связи.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Сообщение для повтора" }
      },
      required: ["message"]
    },
    handler: async (args, { log, logInfo, logError, logSuccess }) => {
      const { message } = args;

      logInfo(`Info: Received echo message: ${message}`);

      return `Echo response:\nMessage: ${message}\nStatus: OK`;
    }
  },

  {
    name: "system_info",
    description: "Предоставляет системную информацию: текущее время (MSK), статус ключевых портов (1337, 3000, 3001, 8080, 5000) и статистику процессов Node.js.",
    inputSchema: {
      type: "object",
      properties: {
        include_processes: { type: "boolean", default: false, description: "Включить детальный список процессов Node.js" },
        max_processes: { type: "number", default: 10, description: "Максимум процессов для вывода" }
      },
      required: []
    },
    handler: async (args) => {
      const { include_processes = false, max_processes = 10 } = args;

      try {
        // Время в MSK
        const now = new Date();
        const mskTime = new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Europe/Moscow',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).format(now);

        // Проверка портов (macOS)
        const checkPort = async (port) => {
          try {
            const { stdout } = await execAsync(`lsof -i :${port}`);
            return stdout.trim() ? 'ACTIVE' : 'CLOSED';
          } catch {
            return 'CLOSED';
          }
        };

        const ports = {
          1337: await checkPort(1337),
          3000: await checkPort(3000),
          3001: await checkPort(3001),
          8080: await checkPort(8080),
          5000: await checkPort(5000)
        };

        // Процессы Node.js (macOS)
        let nodeProcesses = 0;
        try {
          const { stdout } = await execAsync('pgrep -f node');
          nodeProcesses = stdout.split('\n').filter(line => line.trim()).length;
        } catch {
          nodeProcesses = 0;
        }

        let systemInfo = `System Info Report:\n` +
            `Time (MSK): ${mskTime}\n` +
            `Port Status:\n` +
            `  • 1337: ${ports[1337]}\n` +
            `  • 3000: ${ports[3000]}\n` +
            `  • 3001: ${ports[3001]} (VS Code Bridge)\n` +
            `  • 8080: ${ports[8080]}\n` +
            `  • 5000: ${ports[5000]}\n` +
            `Node.js Processes count: ${nodeProcesses}\n`;

        if (include_processes && nodeProcesses > 0) {
          try {
            const { stdout } = await execAsync('ps aux | grep -i node | grep -v grep');
            const processes = stdout.split('\n')
                .filter(line => line.trim())
                .slice(0, max_processes)
                .map(line => {
                  const parts = line.trim().split(/\s+/);
                  return `  • PID ${parts[1]}: ${Math.round(parseFloat(parts[5]) / 1024)}MB (${parts[3]}% CPU)`;
                });

            systemInfo += `\nNode.js Processes Details:\n${processes.join('\n')}\n`;
          } catch (error) {
            systemInfo += `\nProcess List Error: ${error.message}\n`;
          }
        }

        return systemInfo;
      } catch (error) {
        throw new Error(`System Info Error: ${error.message}`);
      }
    }
  },

  {
    name: "check_port",
    description: "Проверяет статус указанного порта (активен/закрыт) используя системную утилиту lsof.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "number", description: "Номер порта для проверки" },
        protocol: { type: "string", enum: ["tcp", "udp"], default: "tcp", description: "Протокол для проверки" }
      },
      required: ["port"]
    },
    handler: async (args) => {
      const { port, protocol = "tcp" } = args;

      try {
        const { stdout } = await execAsync(`lsof -i :${port}`);
        const isActive = stdout.trim() ? true : false;

        return `Port Check Result:\n` +
            `Port: ${port}\n` +
            `Protocol: ${protocol.toUpperCase()}\n` +
            `Status: ${isActive ? 'ACTIVE' : 'CLOSED'}\n` +
            (isActive ? `\nDetails:\n${stdout.trim()}` : '');
      } catch (error) {
        throw new Error(`Port Check Error (Port: ${port}): ${error.message}`);
      }
    }
  },

  {
    name: "find_process",
    description: "Ищет запущенные процессы по имени используя ps aux. Возвращает PID, использование памяти и CPU.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Имя процесса для поиска" }
      },
      required: ["name"]
    },
    handler: async (args) => {
      const { name } = args;

      try {
        const { stdout } = await execAsync(`ps aux | grep -i "${name}" | grep -v grep`);
        const result = stdout.trim();

        if (result) {
          return `Process Search Result (${name}):\n\n${result}`;
        } else {
          throw new Error(`No processes found matching name: ${name}`);
        }
      } catch (error) {
        throw new Error(`Process Search Error: ${error.message}`);
      }
    }
  },

  {
    name: "safe_curl",
    description: "Выполняет HTTP запросы (GET, POST, PUT, DELETE) к указанному URL используя curl.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL для запроса" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], default: "GET", description: "HTTP метод" },
        data: { type: "string", description: "Данные для POST/PUT запросов" }
      },
      required: ["url"]
    },
    handler: async (args) => {
      const { url, method = "GET", data } = args;

      try {
        let cmd = `curl -s "${url}"`;

        if (method !== 'GET') {
          cmd += ` -X ${method}`;
        }

        if (data) {
          cmd += ` -d "${data}"`;
        }

        const { stdout, stderr } = await execAsync(cmd);

        let response = `HTTP Request (${method} ${url})\n`;

        if (data) {
          response += `Data: ${data}\n`;
        }

        response += `\nResponse:\n${stdout}`;

        if (stderr) {
          response += `\n\nWarnings:\n${stderr}`;
        }

        return response;
      } catch (error) {
        throw new Error(`HTTP Request Error (${method} ${url}): ${error.message}`);
      }
    }
  },

  {
    name: "wait_for_user",
    description: "Запрашивает ввод текста или подтверждение действия от пользователя через системные диалоговые окна.",
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", description: "Вопрос или просьба к пользователю" },
        details: { type: "string", description: "Дополнительные детали (опционально)" },
        expect_answer: {
          type: "boolean",
          default: false,
          description: "true = ожидать текстовый ответ, false = простое подтверждение"
        },
        answer_placeholder: {
          type: "string",
          default: "Введите ваш ответ...",
          description: "Подсказка для поля ввода (только при expect_answer=true)"
        }
      },
      required: ["request"]
    },
    handler: async (args) => {
      const {
        request,
        details = '',
        expect_answer = false,
        answer_placeholder = "Введите ваш ответ..."
      } = args;
      const os = process.platform;

      const title = expect_answer ? "Вопрос от AI" : "Запрос действия";
      const fullRequest = details
          ? `${request}\n\nДетали: ${details}`
          : request;

      try {
        if (os === 'darwin') {
          if (expect_answer) {
            // macOS: диалог с полем ввода
            const script = `display dialog "${fullRequest.replace(/"/g, '\\"')}" with title "${title}" default answer "${answer_placeholder}" buttons {"Отправить", "Отмена"} default button "Отправить"`;
            try {
              const { stdout } = await execAsync(`osascript -e '${script}'`);
              const match = stdout.match(/text returned:(.+)/);
              if (match) {
                return `User Answer: "${match[1].trim()}"`;
              } else {
                throw new Error("Failed to retrieve user input.");
              }
            } catch (error) {
              throw new Error("User cancelled input.");
            }
          } else {
            // macOS: простое подтверждение
            const script = `display dialog "${fullRequest.replace(/"/g, '\\"')}" with title "${title}" buttons {"Выполнено", "Отмена"} default button "Выполнено"`;
            try {
              const { stdout } = await execAsync(`osascript -e '${script}'`);
              if (stdout.includes("Выполнено")) {
                return "User confirmed execution.";
              } else {
                throw new Error("User cancelled operation.");
              }
            } catch (error) {
              throw new Error("User cancelled operation.");
            }
          }
        } else {
          // Windows/Linux fallback
          if (expect_answer) {
            const command = os === 'win32'
                ? `start cmd /k "echo ${title} && echo. && echo ${fullRequest} && echo. && echo Please type your answer in Cursor chat && echo. && pause"`
                : `x-terminal-emulator -e "bash -c 'echo \\"${title}\\"; echo; echo \\"${fullRequest}\\"; echo; echo \\"Please type your answer in Cursor chat\\"; read -p \\"Press Enter...\\"'"`

            await spawnBackground(command);
            return "Waiting for user input in chat...";
          } else {
            const command = os === 'win32'
                ? `start cmd /k "echo ${title} && echo. && echo ${fullRequest} && echo. && echo Close this window when done && echo. && pause"`
                : `x-terminal-emulator -e "bash -c 'echo \\"${title}\\"; echo; echo \\"${fullRequest}\\"; echo; read -p \\"Press Enter when done...\\"'"`

            await spawnBackground(command);
            return "Waiting for user confirmation...";
          }
        }
      } catch (error) {
        throw new Error(`Interaction Error: ${error.message}`);
      }
    }
  }
];

export const terminalModule = {
  namespace: "terminal",
  description: "Системные инструменты",
  tools: terminalTools
};