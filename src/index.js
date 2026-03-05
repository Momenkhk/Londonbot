import fs from 'node:fs';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Colors,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const config = loadConfig();
const { token: TOKEN, guildId: GUILD_ID, staffRoleId: STAFF_ROLE_ID } = config;

if (!TOKEN) {
  throw new Error('Missing token in config.json');
}

const setupSessions = new Map();

const COLOR_MAP = {
  blue: Colors.Blurple,
  gray: Colors.Greyple,
  green: Colors.Green,
  red: Colors.Red,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const commands = [
    {
      name: 'ticket-panel',
      description: 'عرض واجهة نظام التذاكر.',
    },
    {
      name: 'ticket-setup',
      description: 'بدء إعداد بانل التذاكر مباشرة.',
    },
  ];

  if (GUILD_ID) {
    const guild = await readyClient.guilds.fetch(GUILD_ID);
    await guild.commands.set(commands);
    console.log(`Registered slash commands in guild ${GUILD_ID}`);
  } else {
    await readyClient.application.commands.set(commands);
    console.log('Registered global slash commands');
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-panel') {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.DarkBlue)
            .setTitle('نظام التذاكر • Components v2')
            .setDescription('هذا الأمر للعرض، وللإعداد الكامل اضغط زر **بدء الإعداد** أو استخدم `/ticket-setup`.')
            .setFooter({ text: `Requested by ${interaction.user.username}` }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel:setup').setLabel('بدء الإعداد').setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('panel:info')
              .setLabel('الأمر الثاني: /ticket-setup')
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-setup') {
      await showSetupModal(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'panel:setup') {
      await showSetupModal(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'panel:info') {
      await interaction.reply({ content: 'الأوامر المتاحة الآن: `/ticket-panel` و `/ticket-setup` ✅', ephemeral: true });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'panel:base-modal') {
      const state = {
        message: interaction.fields.getTextInputValue('message') || 'مرحبا! اختر نوع التذكرة من الأسفل.',
        title: interaction.fields.getTextInputValue('title') || 'الدعم الفني',
        image: interaction.fields.getTextInputValue('image') || null,
        ticketType: 'menu',
        ticketCount: ['1'],
        color: 'blue',
        sideImage: 'none',
        channelId: interaction.channelId,
      };

      setupSessions.set(interaction.user.id, state);

      const rows = buildSetupRows(interaction);
      await interaction.reply({
        content: 'تم حفظ معلومات الامبد. اختر الإعدادات التالية ثم اضغط نشر البانل.',
        components: rows,
        ephemeral: true,
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('setup:')) {
      const state = setupSessions.get(interaction.user.id);
      if (!state) {
        await interaction.reply({ content: 'جلسة الإعداد انتهت. استخدم /ticket-setup من جديد.', ephemeral: true });
        return;
      }

      if (interaction.customId === 'setup:type') state.ticketType = interaction.values[0];
      if (interaction.customId === 'setup:count') state.ticketCount = interaction.values.sort((a, b) => Number(a) - Number(b));
      if (interaction.customId === 'setup:color') state.color = interaction.values[0];
      if (interaction.customId === 'setup:side-image') state.sideImage = interaction.values[0];
      if (interaction.customId === 'setup:channel') state.channelId = interaction.values[0];

      setupSessions.set(interaction.user.id, state);
      await interaction.reply({ content: 'تم تحديث الإعداد ✅', ephemeral: true });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'setup:publish') {
      await publishPanel(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:open-menu') {
      await createTicketChannel(interaction, interaction.values[0]);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket:open:')) {
      const ticketNo = interaction.customId.split(':').at(-1);
      await createTicketChannel(interaction, ticketNo);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket:close') {
      await interaction.reply({ content: 'سيتم إغلاق التذكرة بعد 5 ثوان...', ephemeral: true });
      setTimeout(() => interaction.channel.delete('Ticket closed').catch(() => null), 5000);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket:claim') {
      await interaction.reply({ content: `تم استلام التذكرة بواسطة ${interaction.user}.`, allowedMentions: { parse: [] } });
    }
  } catch (error) {
    console.error(error);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'حدث خطأ أثناء التنفيذ.', ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: 'حدث خطأ أثناء التنفيذ.', ephemeral: true }).catch(() => null);
    }
  }
});

function buildSetupRows(interaction) {
  const textChannels = interaction.guild.channels.cache
    .filter((ch) => ch.type === ChannelType.GuildText)
    .first(25)
    .map((ch) => ({ label: ch.name.slice(0, 100), value: ch.id }));

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('setup:type').setPlaceholder('اختر نوع التذاكر').addOptions([
        { label: 'Menu / منيو', value: 'menu' },
        { label: 'Buttons / ازرار', value: 'buttons' },
      ]),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup:count')
        .setPlaceholder('اختر عدد التذاكر (1 - 10)')
        .setMinValues(1)
        .setMaxValues(10)
        .addOptions(
          Array.from({ length: 10 }, (_, idx) => ({
            label: `التذكرة رقم ${idx + 1}`,
            value: String(idx + 1),
            emoji: '📥',
          })),
        ),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('setup:color').setPlaceholder('اختر لون الزر').addOptions([
        { label: 'أزرق', value: 'blue' },
        { label: 'رصاصي', value: 'gray' },
        { label: 'أخضر', value: 'green' },
        { label: 'أحمر', value: 'red' },
      ]),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('setup:side-image').setPlaceholder('صورة الامبد على اليمين').addOptions([
        { label: 'صورتك', value: 'user' },
        { label: 'صورة السيرفر', value: 'guild' },
        { label: 'صورة البوت', value: 'bot' },
        { label: 'لاشيء', value: 'none' },
      ]),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup:channel')
        .setPlaceholder('اختر روم لارسال البانل')
        .addOptions(textChannels.length ? textChannels : [{ label: 'هذا الروم', value: interaction.channelId }]),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:publish').setLabel('نشر البانل').setStyle(ButtonStyle.Success),
    ),
  ];
}

async function showSetupModal(interaction) {
  const modal = new ModalBuilder().setCustomId('panel:base-modal').setTitle('انشاء معلومات الامبد');

  const messageInput = new TextInputBuilder()
    .setCustomId('message')
    .setLabel('رسالة الامبد (اختياري)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000);

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('عنوان الامبد (اختياري)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200);

  const imageInput = new TextInputBuilder()
    .setCustomId('image')
    .setLabel('رابط صورة الامبد (اختياري)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(messageInput),
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(imageInput),
  );

  await interaction.showModal(modal);
}

async function publishPanel(interaction) {
  const state = setupSessions.get(interaction.user.id);
  if (!state) {
    await interaction.reply({ content: 'جلسة الإعداد انتهت. استخدم /ticket-setup من جديد.', ephemeral: true });
    return;
  }

  const channel = await interaction.guild.channels.fetch(state.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: 'تعذر العثور على روم نصي صالح.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR_MAP[state.color] ?? Colors.Blurple)
    .setTitle(state.title)
    .setDescription(state.message)
    .setTimestamp();

  if (state.image && /^https?:\/\//.test(state.image)) embed.setImage(state.image);
  if (state.sideImage === 'user') embed.setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 512 }));
  if (state.sideImage === 'guild') embed.setThumbnail(interaction.guild.iconURL({ extension: 'png', size: 512 }));
  if (state.sideImage === 'bot') embed.setThumbnail(client.user.displayAvatarURL({ extension: 'png', size: 512 }));

  const sortedTickets = [...state.ticketCount].sort((a, b) => Number(a) - Number(b));
  const style =
    state.color === 'green'
      ? ButtonStyle.Success
      : state.color === 'red'
        ? ButtonStyle.Danger
        : state.color === 'gray'
          ? ButtonStyle.Secondary
          : ButtonStyle.Primary;

  const components = [];
  if (state.ticketType === 'menu') {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ticket:open-menu')
          .setPlaceholder('اختر التذكرة')
          .addOptions(
            sortedTickets.map((ticketNo) => ({
              label: `التذكرة رقم ${ticketNo}`,
              value: ticketNo,
              emoji: '🎫',
            })),
          ),
      ),
    );
  } else {
    let row = new ActionRowBuilder();
    sortedTickets.forEach((ticketNo, idx) => {
      if (idx > 0 && idx % 5 === 0) {
        components.push(row);
        row = new ActionRowBuilder();
      }
      row.addComponents(new ButtonBuilder().setCustomId(`ticket:open:${ticketNo}`).setLabel(`ticket ${ticketNo}`).setStyle(style));
    });
    components.push(row);
  }

  await channel.send({ embeds: [embed], components });
  setupSessions.delete(interaction.user.id);
  await interaction.reply({ content: `تم إرسال البانل في <#${channel.id}> بنجاح ✅`, ephemeral: true });
}

async function createTicketChannel(interaction, ticketNo) {
  const channelName = `ticket-${ticketNo}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
  ];

  if (STAFF_ROLE_ID) {
    overwrites.push({
      id: STAFF_ROLE_ID,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
    });
  }

  const channel = await interaction.guild.channels.create({
    name: channelName.slice(0, 95),
    type: ChannelType.GuildText,
    permissionOverwrites: overwrites,
    reason: `Ticket ${ticketNo} opened by ${interaction.user.tag}`,
  });

  await channel.send({
    content: `أهلًا ${interaction.user}، تم فتح التذكرة رقم **${ticketNo}**. الرجاء شرح مشكلتك بالتفصيل.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:close').setLabel('اغلاق التذكرة').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket:claim').setLabel('استلام').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });

  await interaction.reply({ content: `تم فتح تذكرتك: ${channel}`, ephemeral: true });
}

function loadConfig() {
  const raw = fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

client.login(TOKEN);
