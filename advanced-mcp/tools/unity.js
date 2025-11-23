/**
 * Unity Bridge MCP Module
 *
 * Модуль обеспечивает взаимодействие с Unity Editor через HTTP API.
 * Позволяет выполнять C# код, анализировать сцену и делать скриншоты.
 */

import axios from 'axios';

const UNITY_BASE_URL = 'http://localhost:7777';

/**
 * Преобразует ответ Unity в формат MCP.
 * Поддерживает новый формат { messages: [] } и legacy-формат.
 */
function convertToMCPResponse(unityResponse) {
  if (unityResponse.messages && Array.isArray(unityResponse.messages)) {
    const content = [];

    for (const msg of unityResponse.messages) {
      if (msg.type === 'text') {
        content.push({
          type: 'text',
          text: msg.content
        });
      } else if (msg.type === 'image') {
        if (msg.text) {
          content.push({
            type: 'text',
            text: msg.text
          });
        }
        content.push({
          type: 'image',
          data: msg.content,
          mimeType: 'image/png'
        });
      }
    }

    return { content };
  }

  return convertLegacyResponse(unityResponse);
}

/**
 * Обработчик устаревшего формата ответов Unity.
 */
function convertLegacyResponse(unityData) {
  const content = [];

  if (unityData.message) {
    content.push({
      type: 'text',
      text: unityData.message
    });
  }

  if (unityData.data && unityData.data !== unityData.message) {
    content.push({
      type: 'text',
      text: unityData.data
    });
  }

  if (unityData.image) {
    content.push({
      type: 'text',
      text: 'Unity Screenshot'
    });
    content.push({
      type: 'image',
      data: unityData.image,
      mimeType: 'image/png'
    });
  }

  if (unityData.errors && unityData.errors.length > 0) {
    const errorText = unityData.errors.map(err => {
      if (typeof err === 'object') {
        const level = err.Level || err.level || 'Info';
        const message = err.Message || err.message || 'Unknown error';
        return `${level}: ${message}`;
      }
      return err.toString();
    }).join('\n');

    content.push({
      type: 'text',
      text: `Unity Logs:\n${errorText}`
    });
  }

  if (content.length === 0) {
    content.push({
      type: 'text',
      text: `Unity Status: ${unityData.status || 'Unknown'}`
    });
  }

  return { content };
}

/**
 * Выполняет HTTP запрос к Unity API.
 */
async function handleUnityRequest(endpoint, data = {}, timeout = 10000) {
  try {
    const jsonData = JSON.stringify(data);

    const response = await axios.post(`${UNITY_BASE_URL}${endpoint}`, jsonData, {
      timeout,
      responseType: 'json',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json; charset=utf-8'
      }
    });

    return convertToMCPResponse(response.data);
  } catch (error) {
    const errorContent = [{
      type: 'text',
      text: `Unity Connection Error: ${error.message}\nCheck: Unity running, Bridge Window open, Port 7777 active.`
    }];

    if (error.response?.data) {
      try {
        const unityError = convertToMCPResponse(error.response.data);
        errorContent.push(...unityError.content);
      } catch {
        errorContent.push({
          type: 'text',
          text: `Unity Error Details: ${JSON.stringify(error.response.data)}`
        });
      }
    }

    return { content: errorContent };
  }
}

const unityTools = [
  {
    name: "screenshot",
    description: 'Делает скриншот окна Game View в Unity.',
    inputSchema: {
      type: 'object',
      properties: {
        systemScreenshot: {
          type: 'boolean',
          default: false,
          description: 'Включить скриншот всего рабочего стола. Использовать только при крайней необходимости.'
        }
      },
      required: []
    },
    handler: async (params) => {
      return await handleUnityRequest('/api/screenshot');
    }
  },

  {
    name: "camera_screenshot",
    description: 'Делает скриншот с произвольной позиции камеры в сцене.',
    inputSchema: {
      type: 'object',
      properties: {
        position: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Позиция камеры [x, y, z]'
        },
        target: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Точка направления камеры [x, y, z]'
        },
        width: {
          type: 'number',
          default: 1920,
          minimum: 256,
          maximum: 4096,
          description: 'Ширина скриншота (px)'
        },
        height: {
          type: 'number',
          default: 1080,
          minimum: 256,
          maximum: 4096,
          description: 'Высота скриншота (px)'
        },
        fov: {
          type: 'number',
          default: 60,
          minimum: 10,
          maximum: 179,
          description: 'FOV камеры'
        },
        systemScreenshot: {
          type: 'boolean',
          default: false,
          description: 'Включить скриншот всего рабочего стола. Использовать только при крайней необходимости.'
        }
      },
      required: ['position', 'target']
    },
    handler: async (params) => {
      const requestBody = {
        position: params.position,
        target: params.target,
        fov: params.fov || 60,
        width: params.width || 1920,
        height: params.height || 1080
      };

      return await handleUnityRequest('/api/camera_screenshot', requestBody, 20000);
    }
  },

  {
    name: "scene_hierarchy",
    description: 'Анализирует иерархию сцены и возвращает список объектов.',
    inputSchema: {
      type: 'object',
      properties: {
        detailed: {
          type: 'boolean',
          default: false,
          description: 'Детальный режим: включает позицию, компоненты и свойства объектов.'
        },
        systemScreenshot: {
          type: 'boolean',
          default: false,
          description: 'Включить скриншот всего рабочего стола. Использовать только при крайней необходимости.'
        }
      },
      required: []
    },
    handler: async (params) => {
      const requestBody = {
        detailed: params.detailed || false
      };

      return await handleUnityRequest('/api/scene_hierarchy', requestBody, 15000);
    }
  },

  {
    name: "execute",
    description: 'Выполняет C# код в Unity Editor. Код оборачивается в метод, поэтому соблюдайте строгие правила структуры.\n\n' +
        '⚠️ **ПРАВИЛА НАПИСАНИЯ КОДА:**\n' +
        '1. **Контекст исполнения**: Ваш код (кроме классов) помещается ВНУТРЬ статического метода `Execute()`. Пишите логику сразу, как в теле функции.\n' +
        '2. **Методы**: ЗАПРЕЩЕНО объявлять методы с модификаторами (`public void Foo()`) вне классов — это вызовет ошибку. Используйте локальные функции (без модификаторов) или методы внутри своих классов.\n' +
        '3. **Классы**: Вы МОЖЕТЕ объявлять классы (`public class MyHelper { ... }`). Инструмент извлечет их из метода и поместит рядом.\n' +
        '4. **Возврат значения**: Используйте `return value;` чтобы вернуть результат в чат. Иначе вернется стандартное сообщение.\n' +
        '5. **Namespaces**: НЕ оборачивайте код в `namespace`. \n' +
        '6. **Using**: Базовые (`UnityEngine`, `UnityEditor`) уже подключены. Свои добавляйте в начало.\n\n' +
        '✅ **Пример правильного кода:**\n' +
        '`var obj = new GameObject("Test"); return obj.name;`\n\n' +
        '❌ **Пример ошибки:**\n' +
        '`public void Start() { ... }` (нельзя метод внутри метода)',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'C# код для выполнения'
        },
        systemScreenshot: {
          type: 'boolean',
          default: false,
          description: 'Включить скриншот всего рабочего стола. Использовать только при крайней необходимости.'
        }
      },
      required: ['code']
    },
    handler: async (params) => {
      const requestBody = {
        code: params.code
      };

      return await handleUnityRequest('/api/execute', requestBody, 30000);
    }
  }
];

export const unityModule = {
  name: 'unity',
  description: 'Unity Bridge: Инструменты для взаимодействия с Unity Editor (Code Execution, Scene Analysis, Screenshots).',
  tools: unityTools,

  decorators: {
    disableSystemInfo: true,
    disableDebugLogs: true
  }
};