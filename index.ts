import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface VectorWithMetadata {
  node: FigmaNode;
  filename: string;
}

interface Spine2DAttachment {
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
}

interface Spine2DSlot {
  name: string;
  bone: string;
  attachment: string;
}

interface Spine2DSkin {
  name: string;
  attachments: {
    [slotName: string]: {
      [attachmentName: string]: Spine2DAttachment;
    };
  };
}

interface Spine2DData {
  bones: Array<{ name: string }>;
  slots: Spine2DSlot[];
  skins: Spine2DSkin[];
  animations: {
    empty: {};
  };
}

interface FigmaFile {
  document: FigmaNode;
}

interface FigmaImageResponse {
  images: { [key: string]: string };
}

// Получение токена из переменной окружения
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;

if (!FIGMA_TOKEN) {
  console.error('Ошибка: Необходимо установить переменную окружения FIGMA_TOKEN');
  process.exit(1);
}

// Парсинг аргументов командной строки
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Использование: ts-node index.ts <document-id> <frame-name-pattern> [scale]');
  console.error('Пример: ts-node index.ts abc123 "Character.*" 1.0');
  console.error('  scale - коэффициент масштабирования (по умолчанию: 0.5)');
  process.exit(1);
}

const [documentId, frameNamePattern, scaleArg] = args;
const scale = scaleArg ? parseFloat(scaleArg) : 0.5;

if (isNaN(scale) || scale <= 0) {
  console.error('Ошибка: scale должен быть положительным числом');
  process.exit(1);
}

/**
 * Выполняет GET запрос к Figma API
 */
function figmaApiRequest(endpoint: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.figma.com',
      path: endpoint,
      method: 'GET',
      headers: {
        'X-Figma-Token': FIGMA_TOKEN
      }
    };

    https.get(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else if (res.statusCode === 429) {
          // Rate limit exceeded - выводим дополнительную информацию
          const headers = res.headers;
          let errorMessage = `Figma API вернул статус 429 (Rate Limit Exceeded)\n`;
          errorMessage += `Ответ: ${data}\n`;
          errorMessage += `\nЗаголовки ответа:\n`;
          
          if (headers['retry-after']) {
            errorMessage += `  Retry-After: ${headers['retry-after']}\n`;
          }
          if (headers['x-figma-plan-tier']) {
            errorMessage += `  X-Figma-Plan-Tier: ${headers['x-figma-plan-tier']}\n`;
          }
          if (headers['x-figma-rate-limit-type']) {
            errorMessage += `  X-Figma-Rate-Limit-Type: ${headers['x-figma-rate-limit-type']}\n`;
          }
          if (headers['x-figma-upgrade-link']) {
            errorMessage += `  X-Figma-Upgrade-Link: ${headers['x-figma-upgrade-link']}\n`;
          }
          
          reject(new Error(errorMessage));
        } else {
          reject(new Error(`Figma API вернул статус ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Скачивает изображение по URL и сохраняет в файл
 */
function downloadImage(url: string, filepath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Следуем редиректу
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl, filepath).then(resolve).catch(reject);
          return;
        }
      }

      const fileStream = fs.createWriteStream(filepath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(filepath, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Рекурсивно ищет все векторные изображения в узле
 */
function findVectorImages(node: FigmaNode, vectors: FigmaNode[] = []): FigmaNode[] {
  // Типы векторных объектов в Figma
  const vectorTypes = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'REGULAR_POLYGON'];
  
  if (vectorTypes.includes(node.type)) {
    vectors.push(node);
  }

  if (node.children) {
    for (const child of node.children) {
      findVectorImages(child, vectors);
    }
  }

  return vectors;
}

/**
 * Рекурсивно ищет фрейм по шаблону имени
 */
function findFrameByPattern(node: FigmaNode, pattern: string): FigmaNode | null {
  const regex = new RegExp(pattern);
  
  if (node.type === 'FRAME' && regex.test(node.name)) {
    return node;
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findFrameByPattern(child, pattern);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

/**
 * Основная функция
 */
async function main() {
  try {
    console.log(`Получение документа Figma: ${documentId}`);
    console.log(`Коэффициент масштабирования: ${scale}`);
    
    // Получаем структуру документа
    const fileData: FigmaFile = await figmaApiRequest(`/v1/files/${documentId}`);
    
    console.log(`Поиск фрейма с шаблоном имени: "${frameNamePattern}"`);
    
    // Ищем фрейм по шаблону
    const targetFrame = findFrameByPattern(fileData.document, frameNamePattern);
    
    if (!targetFrame) {
      console.error(`Фрейм с шаблоном "${frameNamePattern}" не найден`);
      process.exit(1);
    }
    
    console.log(`Найден фрейм: "${targetFrame.name}" (ID: ${targetFrame.id})`);
    
    // Находим все векторные изображения внутри фрейма
    const vectors = findVectorImages(targetFrame);
    
    if (vectors.length === 0) {
      console.log('Векторные изображения не найдены в этом фрейме');
      return;
    }
    
    console.log(`Найдено векторных изображений: ${vectors.length}`);
    
    // Получаем URL для экспорта изображений
    const nodeIds = vectors.map(v => v.id).join(',');
    console.log('Запрос URL для экспорта изображений...');
    
    const imageData: FigmaImageResponse = await figmaApiRequest(
      `/v1/images/${documentId}?ids=${nodeIds}&format=png&scale=${scale}`
    );
    
    // Создаем папку для сохранения, если нужно
    const outputDir = path.join(process.cwd(), 'dist');
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`Создана папка: ${outputDir}`);
    }
    
    // Скачиваем каждое изображение и собираем метаданные
    let savedCount = 0;
    const nameCounter: { [key: string]: number } = {};
    const vectorsWithMetadata: VectorWithMetadata[] = [];
    
    // Получаем границы фрейма для расчета относительных позиций
    const frameBounds = targetFrame.absoluteBoundingBox;
    if (!frameBounds) {
      console.error('Не удалось получить границы фрейма');
      process.exit(1);
    }
    
    // Вычисляем центр фрейма (origin для Spine2D)
    const frameCenterX = frameBounds.x + frameBounds.width / 2;
    const frameCenterY = frameBounds.y + frameBounds.height / 2;
    
    for (const vector of vectors) {
      const imageUrl = imageData.images[vector.id];
      
      if (!imageUrl) {
        console.warn(`Не удалось получить URL для изображения: ${vector.name}`);
        continue;
      }
      
      // Формируем безопасное имя файла (сохраняем кириллицу и другие Unicode символы)
      const safeName = vector.name.replace(/[<>:"/\\|?*]/g, '_');
      
      // Обрабатываем повторяющиеся имена
      let filename: string;
      if (nameCounter[safeName] === undefined) {
        nameCounter[safeName] = 0;
        filename = `${safeName}.png`;
      } else {
        nameCounter[safeName]++;
        filename = `${safeName}-${nameCounter[safeName]}.png`;
      }
      
      const filepath = path.join(outputDir, filename);
      
      console.log(`Сохранение: ${filename}`);
      await downloadImage(imageUrl, filepath);
      savedCount++;
      
      // Сохраняем метаданные для Spine2D
      vectorsWithMetadata.push({
        node: vector,
        filename: filename.replace('.png', '')
      });
    }
    
    // Создаем JSON файл для Spine2D
    const spine2dData: Spine2DData = {
      bones: [{ name: 'root' }],
      slots: [],
      skins: [
        {
          name: 'default',
          attachments: {}
        }
      ],
      animations: {
        empty: {}
      }
    };
    
    // Заполняем слоты и attachments
    for (const vectorMeta of vectorsWithMetadata) {
      const slotName = vectorMeta.filename;
      
      // Добавляем слот
      spine2dData.slots.push({
        name: slotName,
        bone: 'root',
        attachment: slotName
      });
      
      // Вычисляем позицию относительно центра фрейма
      const bounds = vectorMeta.node.absoluteBoundingBox;
      if (!bounds) {
        console.warn(`Не удалось получить границы для ${vectorMeta.node.name}`);
        continue;
      }
      
      // Центр объекта
      const objCenterX = bounds.x + bounds.width / 2;
      const objCenterY = bounds.y + bounds.height / 2;
      
      // Относительная позиция от центра фрейма
      // В Spine2D: X вправо, Y вверх (инвертируем Y из Figma)
      const relativeX = (objCenterX - frameCenterX) * scale;
      const relativeY = -(objCenterY - frameCenterY) * scale;
      
      // Добавляем attachment
      spine2dData.skins[0].attachments[slotName] = {
        [slotName]: {
          x: parseFloat(relativeX.toFixed(2)),
          y: parseFloat(relativeY.toFixed(2)),
          rotation: 0,
          width: Math.round(bounds.width * scale),
          height: Math.round(bounds.height * scale)
        }
      };
    }
    
    // Сохраняем JSON файл
    const jsonFilename = `${targetFrame.name.replace(/[<>:"/\\|?*]/g, '_')}.json`;
    const jsonPath = path.join(outputDir, jsonFilename);
    fs.writeFileSync(jsonPath, JSON.stringify(spine2dData, null, '\t'));
    
    console.log(`\nУспешно сохранено изображений: ${savedCount} из ${vectors.length}`);
    console.log(`Создан файл Spine2D: ${jsonFilename}`);
    console.log(`Папка: ${outputDir}`);
    
  } catch (error) {
    console.error('Ошибка:', error);
    process.exit(1);
  }
}

main();
