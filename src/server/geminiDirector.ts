import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildCityDirectorPromptContext,
  type AiDirectorRawBundle,
} from '../sim/aiDirector';
import type { CityState } from '../sim/types';

export class AiDirectorError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function generateMacauDynamicContent(
  state: CityState,
  customTheme?: string,
  includeEvent = true,
): Promise<AiDirectorRawBundle> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiDirectorError(
      503,
      '伺服器尚未設定 GEMINI_API_KEY，無法呼叫 Gemini AI 城市導演（請於 Settings > Secrets 設定金鑰）',
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const promptContext = buildCityDirectorPromptContext(state, customTheme);
  const systemInstruction = [
    '你是《澳門天際線 Macau Slim City》遊戲的「AI 城市導演」，負責根據即時城市數據自動生成澳門在地化、充滿活力的 3D 動態城市事件、限時都市挑戰與決策事件。',
    '請全程使用繁體中文（澳門粵語／港澳用語風格，如格蘭披治、路氹、南灣、葡韻、大三巴、巴士專線、夜市市集、花車巡遊、無人機燈光秀）。',
    'dynamicElement.kind 必須從 parade_float（沿道路行駛的節慶巡遊花車）、drone_show（空中無人機燈光編隊）、street_market（快閃美食文創市集）、harbor_flotilla（跨海觀光龍舟船隊）四種擇一，且須與主題高度契合。',
    'dynamicElement.districtName 請優先選用目前「已解鎖澳門分區」中的真實地名。',
    'dynamicElement.accentColor 必須是鮮明清晰的 6 位十六進位色碼（如 #f59e0b、#38bdf8、#ec4899、#10b981）。',
    'quest.targetDeltaOrFloor：當 goalType 為 reach_population 時填寫需增加的人口數（40~220）；build_buildings 填新增棟數（1~4）；improve_traffic 填目標流暢度（75~95）；unlock_districts 填新增解鎖區數（1）；treasury_goal 填需增加的庫房金額（3000~15000）。',
    includeEvent
      ? '請同時填寫 event 物件，設計一個有趣且具策略權衡的澳門突發決策事件（兩個選項需有利弊權衡）。'
      : '請務必將 event 設為 null，只需生成動態實景與動態挑戰即可。',
  ].join('\n');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `請根據以下即時城市狀態生成一組全新遊戲動態元素：\n\n${promptContext}`,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: {
              type: Type.STRING,
              description: '精簡吸睛的澳門市政快訊標題（15-38字）',
            },
            dynamicElement: {
              type: Type.OBJECT,
              properties: {
                kind: {
                  type: Type.STRING,
                  enum: ['parade_float', 'drone_show', 'street_market', 'harbor_flotilla'],
                },
                title: { type: Type.STRING },
                districtName: { type: Type.STRING },
                description: { type: Type.STRING },
                accentColor: { type: Type.STRING },
                durationTicks: { type: Type.INTEGER },
                happinessBonus: { type: Type.INTEGER },
                tourismBonus: { type: Type.INTEGER },
              },
              required: [
                'kind',
                'title',
                'districtName',
                'description',
                'accentColor',
                'durationTicks',
                'happinessBonus',
                'tourismBonus',
              ],
            },
            quest: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                goalType: {
                  type: Type.STRING,
                  enum: [
                    'reach_population',
                    'build_buildings',
                    'improve_traffic',
                    'unlock_districts',
                    'treasury_goal',
                  ],
                },
                targetDeltaOrFloor: { type: Type.INTEGER },
                rewardTreasury: { type: Type.INTEGER },
                rewardHappiness: { type: Type.INTEGER },
                durationTicks: { type: Type.INTEGER },
              },
              required: [
                'title',
                'description',
                'goalType',
                'targetDeltaOrFloor',
                'rewardTreasury',
                'rewardHappiness',
                'durationTicks',
              ],
            },
            event: {
              type: Type.OBJECT,
              nullable: true,
              properties: {
                title: { type: Type.STRING },
                category: {
                  type: Type.STRING,
                  enum: ['festival', 'weather', 'market', 'transit', 'heritage'],
                },
                description: { type: Type.STRING },
                choiceALabel: { type: Type.STRING },
                choiceAEffectSummary: { type: Type.STRING },
                choiceATreasuryDelta: { type: Type.INTEGER },
                choiceAHappinessDelta: { type: Type.INTEGER },
                choiceATrafficRelief: { type: Type.INTEGER },
                choiceATourismBoost: { type: Type.BOOLEAN },
                choiceBLabel: { type: Type.STRING },
                choiceBEffectSummary: { type: Type.STRING },
                choiceBTreasuryDelta: { type: Type.INTEGER },
                choiceBHappinessDelta: { type: Type.INTEGER },
                choiceBTrafficRelief: { type: Type.INTEGER },
                choiceBLandBoom: { type: Type.BOOLEAN },
              },
              required: [
                'title',
                'category',
                'description',
                'choiceALabel',
                'choiceAEffectSummary',
                'choiceATreasuryDelta',
                'choiceAHappinessDelta',
                'choiceATrafficRelief',
                'choiceATourismBoost',
                'choiceBLabel',
                'choiceBEffectSummary',
                'choiceBTreasuryDelta',
                'choiceBHappinessDelta',
                'choiceBTrafficRelief',
                'choiceBLandBoom',
              ],
            },
          },
          required: ['headline', 'dynamicElement', 'quest'],
        },
      },
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      throw new AiDirectorError(502, 'Gemini API 未回傳有效內容');
    }

    const parsed = JSON.parse(rawText) as AiDirectorRawBundle;
    if (!parsed?.dynamicElement || !parsed?.quest) {
      throw new AiDirectorError(502, 'Gemini API 回傳格式缺少必要欄位');
    }
    return parsed;
  } catch (err) {
    if (err instanceof AiDirectorError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const status =
      /429|RESOURCE_EXHAUSTED/i.test(msg)
        ? 429
        : /403|PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)
          ? 403
          : 502;
    throw new AiDirectorError(status, `AI 城市導演連線失敗：${msg}`);
  }
}
