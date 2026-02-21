const OpenAI = require('openai');
const BaseProvider = require('./base');

class OpenAIProvider extends BaseProvider {
  constructor(apiKey, options = {}) {
    super(apiKey, options);
    this.client = new OpenAI({ apiKey });
    this.model = options.model || 'gpt-4o';
  }

  async analyze(captureData, options = {}) {
    const prompt = this.buildPrompt(captureData, options);

    // Build content array with images
    const content = [];

    // Add screenshots as images
    for (const screenshot of captureData.screenshots) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${screenshot.buffer.toString('base64')}`,
          detail: 'high',
        },
      });
      content.push({
        type: 'text',
        text: `[Screenshot: ${screenshot.viewport} - ${screenshot.width}x${screenshot.height}]`,
      });
    }

    // Add the analysis prompt
    content.push({
      type: 'text',
      text: prompt,
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });

    const responseText = response.choices[0]?.message?.content || '';
    return this.parseResponse(responseText);
  }
  async reviewCode(diff, context, options = {}) {
    const prompt = this.buildReviewPrompt(diff, context, options);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = response.choices[0]?.message?.content || '';
    return this.parseResponse(responseText);
  }
}

module.exports = OpenAIProvider;
