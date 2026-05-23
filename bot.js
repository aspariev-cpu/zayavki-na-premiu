const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
require('dotenv').config();

// ПРОВЕРКА ТОКЕНА ПЕРЕД ЗАПУСКОМ
console.log('🔍 Проверка конфигурации...');
console.log('Token loaded:', process.env.DISCORD_TOKEN ? '✅ Да' : '❌ НЕТ');
console.log('Owner ID loaded:', process.env.OWNER_ID ? '✅ Да' : '❌ НЕТ');

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ОШИБКА: Токен не найден в .env файле!');
    console.error('Создай файл .env и добавь туда:');
    console.error('DISCORD_TOKEN=твой_токен');
    console.error('OWNER_ID=твой_discord_id');
    process.exit(1);
}

if (!process.env.OWNER_ID) {
    console.error('❌ ОШИБКА: OWNER_ID не найден в .env файле!');
    console.error('Добавь в .env файл: OWNER_ID=твой_discord_id');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const YOUR_USER_ID = process.env.OWNER_ID;

// Хранилище временных данных для скриншотов
const userScreenshots = new Map();

client.once('ready', () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    console.log(`📨 Заявки будут приходить к <@${YOUR_USER_ID}>`);
    console.log(`💰 Максимальная сумма запроса: 100 000 ₽`);
});

// Команда !form
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (message.content === '!form') {
        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_form')
                .setLabel('📝 Заполнить заявку')
                .setStyle(ButtonStyle.Primary)
        );

        await message.channel.send({
            content: 'Нажми на кнопку, чтобы заполнить заявку:',
            components: [button]
        });
    }
});

// Обработка кнопки открытия формы
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'open_form') return;

    const modal = new ModalBuilder()
        .setCustomId(`money_form_${interaction.user.id}`)
        .setTitle('💰 Заявка на финансирование');

    const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Сколько денег вам требуется? (до 100 000 ₽)')  // ⚠️ ПРЕДУПРЕЖДЕНИЕ В ЛЕЙБЛЕ
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: 50 000 ₽ (максимум 100 000 ₽)')  // ⚠️ ПРЕДУПРЕЖДЕНИЕ В ПЛЕЙСХОЛДЕРЕ
        .setRequired(true);

    const currentMoneyInput = new TextInputBuilder()
        .setCustomId('current_money')
        .setLabel('Сколько сейчас у вас средств?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: 10 000 ₽')
        .setRequired(true);

    const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Зачем вам нужны эти деньги?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Напишите подробную причину...')
        .setRequired(true);

    const firstRow = new ActionRowBuilder().addComponents(amountInput);
    const secondRow = new ActionRowBuilder().addComponents(currentMoneyInput);
    const thirdRow = new ActionRowBuilder().addComponents(reasonInput);

    modal.addComponents(firstRow, secondRow, thirdRow);

    await interaction.showModal(modal);
});

// Обработка отправки формы (модальное окно)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('money_form_')) return;

    const amountRaw = interaction.fields.getTextInputValue('amount');
    const currentMoney = interaction.fields.getTextInputValue('current_money');
    const reason = interaction.fields.getTextInputValue('reason');
    const userName = interaction.user.tag;
    const userId = interaction.user.id;

    // 🔥 ПРОВЕРКА: сумма не должна превышать 100 000
    const amountNumber = parseInt(amountRaw.replace(/[^\d-]/g, ''), 10);
    
    if (isNaN(amountNumber) || amountNumber > 100000) {
        return interaction.reply({
            content: `❌ **Ошибка!**\n\nСумма запроса не может превышать **100 000 ₽**.\n\nВы указали: ${amountRaw}\n\n⚠️ **Напоминание:** Максимальная сумма для одной заявки — **100 000 ₽**.\n\nПожалуйста, начните заново с команды \`!form\` и укажите корректную сумму.`,
            ephemeral: true
        });
    }
    
    if (amountNumber <= 0) {
        return interaction.reply({
            content: `❌ **Ошибка!**\n\nСумма должна быть положительным числом.\n\nВы указали: ${amountRaw}\n\nПожалуйста, начните заново с команды \`!form\`.`,
            ephemeral: true
        });
    }

    // Сохраняем данные заявки для последующего добавления скриншота
    userScreenshots.set(userId, {
        amount: amountRaw,
        currentMoney,
        reason,
        userName,
        timestamp: Date.now()
    });

    // Отправляем кнопку для загрузки скриншота (ЭФЕМЕРНОЕ сообщение)
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`add_screenshot_${userId}`)
            .setLabel('📸 Добавить скриншот средств')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        content: `✅ **Часть 1/2 заполнена!**\n\n📝 Сумма: **${amountRaw}**\n💰 Текущие средства: **${currentMoney}**\n❓ Причина: ${reason}\n\n**Теперь отправьте скриншот ваших средств** (баланс в игре, кошелек и т.д.)\n\nНажмите на кнопку ниже, чтобы прикрепить изображение:`,
        components: [row],
        ephemeral: true
    });
});

// Обработка кнопки добавления скриншота
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('add_screenshot_')) return;

    const userId = interaction.customId.replace('add_screenshot_', '');
    
    if (userId !== interaction.user.id) {
        return interaction.reply({
            content: '❌ Это не ваша заявка!',
            ephemeral: true
        });
    }

    const formData = userScreenshots.get(userId);
    if (!formData) {
        return interaction.reply({
            content: '❌ Данные заявки не найдены. Пожалуйста, начните заново с команды !form',
            ephemeral: true
        });
    }

    // Отвечаем и ждём файл (ЭФЕМЕРНОЕ сообщение)
    await interaction.reply({
        content: `📸 **Отправьте скриншот ваших средств!**\n\nПоддерживаются: JPG, PNG, GIF, WEBP (до 10 МБ)\nПросто отправьте изображение в этот чат (личное сообщение боту).\n\n⚠️ **Важно:** Отправьте скриншот в **личные сообщения** боту, чтобы не засорять общий чат!`,
        ephemeral: true
    });

    // Устанавливаем флаг, что ждём скриншот от пользователя
    userScreenshots.set(userId, { ...formData, waitingForScreenshot: true });
    
    // Отправляем пользователю напоминание в ЛС
    try {
        await interaction.user.send(`📸 **Напоминание:** Отправьте скриншот ваших средств сюда, чтобы завершить заявку.\n\nПоддерживаются: JPG, PNG, GIF, WEBP (до 10 МБ)`);
    } catch (e) {
        console.log('Не удалось отправить ЛС, возможно у пользователя закрыты сообщения');
    }
});

// Обработка входящих сообщений со скриншотами (ТОЛЬКО В ЛИЧКЕ)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Игнорируем сообщения из каналов (только ЛС)
    if (message.guild) return;
    
    const userId = message.author.id;
    const formData = userScreenshots.get(userId);
    
    // Проверяем, ждём ли скриншот от этого пользователя
    if (!formData || !formData.waitingForScreenshot) return;
    
    // Проверяем, есть ли в сообщении вложение
    if (!message.attachments || message.attachments.size === 0) {
        return message.reply({
            content: '❌ Пожалуйста, отправьте изображение (скриншот ваших средств).'
        });
    }
    
    // Ищем изображения среди вложений
    const screenshot = message.attachments.find(att => att.contentType?.startsWith('image/'));
    
    if (!screenshot) {
        return message.reply({
            content: '❌ Пожалуйста, отправьте изображение в формате JPG, PNG, GIF или WEBP.'
        });
    }
    
    // Отправляем заявку владельцу со скриншотом
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📬 Новая заявка на финансирование!')
        .setDescription(`<@${YOUR_USER_ID}>, поступила новая заявка с подтверждением`)
        .addFields(
            { name: '👤 От кого', value: `${formData.userName} (${userId})`, inline: false },
            { name: '💰 Требуемая сумма', value: formData.amount, inline: true },
            { name: '💵 Текущие средства', value: formData.currentMoney, inline: true },
            { name: '❓ Причина', value: formData.reason, inline: false },
            { name: '📸 Скриншот средств', value: `[Нажмите для просмотра](${screenshot.url})`, inline: false }
        )
        .setImage(screenshot.url)
        .setTimestamp()
        .setFooter({ text: 'Заявка из формы | Требуется подтверждение | Максимум 100 000 ₽' });
    
    // Кнопки для ответа
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`approve_${userId}`)
            .setLabel('✅ Одобрить')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`deny_${userId}`)
            .setLabel('❌ Отклонить')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`ask_${userId}`)
            .setLabel('💬 Уточнить')
            .setStyle(ButtonStyle.Secondary)
    );
    
    try {
        const owner = await client.users.fetch(YOUR_USER_ID);
        await owner.send({ embeds: [embed], components: [row] });
        console.log(`✅ Заявка от ${formData.userName} отправлена владельцу со скриншотом`);
        
        await message.reply({
            content: '✅ **Заявка полностью оформлена!**\n\nВаши данные и скриншот отправлены на рассмотрение. Ответ придет в личные сообщения.'
        });
        
        // Очищаем данные пользователя
        userScreenshots.delete(userId);
        
        // Отправляем подтверждение в канал (короткое, без деталей)
        const guild = client.guilds.cache.first();
        if (guild) {
            const channel = guild.channels.cache.find(ch => ch.name === 'заявки' || ch.name === 'tickets');
            if (channel) {
                await channel.send(`📨 **Новая заявка** от <@${userId}> на сумму ${formData.amount} отправлена на рассмотрение.`);
            }
        }
        
    } catch (error) {
        console.error('❌ Не удалось отправить заявку владельцу:', error);
        await message.reply({
            content: '❌ Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже или свяжитесь с администратором.'
        });
        userScreenshots.delete(userId);
    }
});

// Обработка кнопок ответа (одобрить/отклонить/уточнить)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId.startsWith('approve_')) {
        const userId = interaction.customId.replace('approve_', '');
        
        try {
            const user = await client.users.fetch(userId);
            await user.send('✅ **Ваша заявка одобрена!** Деньги будут выданы в ближайшее время.');
        } catch (e) {}
        
        await interaction.reply({ content: '✅ Заявка одобрена! Уведомление отправлено.', ephemeral: true });
        await interaction.message.edit({ components: [] });
    }
    
    else if (interaction.customId.startsWith('deny_')) {
        const userId = interaction.customId.replace('deny_', '');
        
        const modal = new ModalBuilder()
            .setCustomId(`deny_reason_${userId}`)
            .setTitle('❌ Причина отказа');
        
        const reasonInput = new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Причина отказа:')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Напишите причину отказа...')
            .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
    }
    
    else if (interaction.customId.startsWith('ask_')) {
        const userId = interaction.customId.replace('ask_', '');
        
        const modal = new ModalBuilder()
            .setCustomId(`ask_question_${userId}`)
            .setTitle('💬 Уточнение по заявке');
        
        const questionInput = new TextInputBuilder()
            .setCustomId('question')
            .setLabel('Вопрос пользователю:')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Что нужно уточнить?')
            .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(questionInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
    }
});

// Обработка модального окна с причиной отказа
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    
    if (interaction.customId.startsWith('deny_reason_')) {
        const userId = interaction.customId.replace('deny_reason_', '');
        const reason = interaction.fields.getTextInputValue('reason');
        
        try {
            const user = await client.users.fetch(userId);
            await user.send(`❌ **Ваша заявка отклонена**\n\nПричина: ${reason}\n\nЕсли у вас есть вопросы, свяжитесь с администрацией.`);
        } catch (e) {}
        
        await interaction.reply({ content: '❌ Заявка отклонена! Уведомление отправлено с причиной.', ephemeral: true });
        
        const originalMessage = interaction.message;
        if (originalMessage) {
            const embed = EmbedBuilder.from(originalMessage.embeds[0]).setColor(0xFF0000);
            await originalMessage.edit({ embeds: [embed], components: [] });
        }
    }
    
    else if (interaction.customId.startsWith('ask_question_')) {
        const userId = interaction.customId.replace('ask_question_', '');
        const question = interaction.fields.getTextInputValue('question');
        
        try {
            const user = await client.users.fetch(userId);
            await user.send(`💬 **Уточнение по вашей заявке**\n\n${question}\n\nПожалуйста, ответьте на это сообщение или свяжитесь с администрацией.`);
        } catch (e) {}
        
        await interaction.reply({ content: '💬 Вопрос отправлен пользователю!', ephemeral: true });
    }
});

client.login(TOKEN);
