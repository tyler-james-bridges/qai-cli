const Anthropic = require('@anthropic-ai/sdk');
const BaseProvider = require('./base');

class AnthropicProvider extends BaseProvider {
  constructor(apiKey, options = {}) {
    super(apiKey, options);
    this.client = new Anthropic({ apiKey });
    this.model = options.model || 'claude-sonnet-4-20250514';
  }

  async analyze(captureData, options = {}) {
    const prompt = this.buildPrompt(captureData, options);

    // Build content array with images
    const content = [];

    // Add screenshots as images
    for (const screenshot of captureData.screenshots) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshot.buffer.toString('base64'),
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

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });

    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return this.parseResponse(responseText);
  }
}

module.exports = AnthropicProvider;
