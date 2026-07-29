package com.crux.client.feature;

import com.crux.client.CruxClient;
import com.crux.client.config.CruxConfig;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public class FeatureManager {

    private final List<Feature> features = new ArrayList<>();
    private final CruxConfig config;
    private final Map<FeatureCategory, List<Feature>> categorized = new LinkedHashMap<>();

    private long sessionStart = System.currentTimeMillis();
    private int comboCount = 0;
    private long lastHitTime = 0;
    private long lastClickTime = 0;
    private final AtomicInteger leftClicks = new AtomicInteger();
    private int clicksThisSecond = 0;
    private long lastSecondTime = System.currentTimeMillis();

    public FeatureManager(CruxConfig config) {
        this.config = config;
        for (FeatureCategory cat : FeatureCategory.values()) {
            categorized.put(cat, new ArrayList<>());
        }
        registerAll();
        loadFromConfig();
    }

    private void register(Feature f) {
        features.add(f);
        categorized.get(f.getCategory()).add(f);
    }

    private void registerAll() {
        // === HUD ===
        register(new Feature("FPS", "Zeigt FPS Anzahl", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "" + Minecraft.getInstance().getFps())));

        register(new Feature("Koordinaten", "Zeigt X, Y, Z", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p != null) drawHud(g, f, String.format("%.1f / %.1f / %.1f", p.getX(), p.getY(), p.getZ()));
                }));

        register(new Feature("Ping", "Zeigt Netzwerk-Ping", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p != null) {
                        var pi = p.connection.getPlayerInfo(p.getUUID());
                        int ping = pi != null ? pi.getLatency() : 0;
                        drawHud(g, f, ping + "ms");
                    }
                }));

        register(new Feature("Server", "Zeigt Server-Info", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    Minecraft mc = Minecraft.getInstance();
                    String text;
                    if (mc.getCurrentServer() != null) text = mc.getCurrentServer().ip;
                    else if (mc.isSingleplayer()) text = "Singleplayer";
                    else text = "---";
                    drawHud(g, f, text);
                }));

        register(new Feature("Uhr", "Zeigt aktuelle Uhrzeit", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, LocalDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss")))));

        register(new Feature("CPS", "Klicks pro Sekunde", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "" + leftClicks.get())));

        register(new Feature("Keystrokes", "Zeigt WASD + Mausklicks", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    Minecraft mc = Minecraft.getInstance();
                    LocalPlayer p = mc.player;
                    if (p == null) return;
                    int x = f.getHudX(), y = f.getHudY(), s = 16, gap = 2;
                    drawKey(g, x + s + gap, y, "W", p.input.keyPresses.forward());
                    drawKey(g, x, y + s + gap, "A", p.input.keyPresses.left());
                    drawKey(g, x + s + gap, y + s + gap, "S", p.input.keyPresses.backward());
                    drawKey(g, x + (s + gap) * 2, y + s + gap, "D", p.input.keyPresses.right());
                    f.updateHudBounds(x, y, (s + gap) * 3, (s + gap) * 2);
                }));

        register(new Feature("Rüstung", "Zeigt Rüstungs-Status", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p == null) return;
                    int x = f.getHudX(), y = f.getHudY();
                    for (EquipmentSlot slot : new EquipmentSlot[]{EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET}) {
                        ItemStack stack = p.getItemBySlot(slot);
                        g.renderItem(stack, x, y);
                        g.renderItemDecorations(Minecraft.getInstance().font, stack, x, y);
                        y += 20;
                    }
                    f.updateHudBounds(x, f.getHudY(), 16, 80);
                }));

        register(new Feature("Combo", "Zeigt Combo-Hits", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "" + comboCount)));

        register(new Feature("Tränke", "Zeigt aktive Trank-Effects", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p == null) return;
                    int x = f.getHudX(), y = f.getHudY();
                    Minecraft mc = Minecraft.getInstance();
                    for (MobEffectInstance effect : p.getActiveEffects()) {
                        int color = effect.getEffect().value().getColor();
                        g.fill(x, y, x + 14, y + 14, 0xFF000000);
                        g.fill(x + 1, y + 1, x + 13, y + 13, 0xFF000000 | color);
                        String initial = effect.getEffect().value().getDisplayName().getString().substring(0, 1);
                        g.drawCenteredString(mc.font, initial, x + 7, y + 3, 0xFFFFFFFF);
                        Component displayName = effect.getEffect().value().getDisplayName();
                        g.drawString(mc.font, displayName.getString() + " " + (effect.getDuration() / 20) + "s", x + 18, y + 3, 0xFF55FF55, config.isHudShadow());
                        y += 16;
                    }
                    if (p.getActiveEffects().isEmpty()) { drawAt(g, x, y, "Keine Effekte"); y += 11; }
                    f.updateHudBounds(x, f.getHudY(), 160, y - f.getHudY());
                }));

        register(new Feature("Sättigung", "Zeigt Sättigungs-Level", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p == null) return;
                    int x = f.getHudX(), y = f.getHudY();
                    Minecraft mc = Minecraft.getInstance();
                    float sat = p.getFoodData().getSaturationLevel();
                    int fullIcons = (int) (sat / 2);
                    for (int i = 0; i < 10; i++) {
                        int ix = x + i * 8;
                        if (i < fullIcons) {
                            g.fill(ix, y, ix + 7, y + 7, 0xFFFFAA00);
                            g.fill(ix + 1, y + 1, ix + 6, y + 6, 0xFFFFFF55);
                        } else {
                            g.fill(ix, y, ix + 7, y + 7, 0xFF333333);
                        }
                    }
                    y += 10;
                    g.drawString(mc.font, String.format("%.1f / 20", sat), x, y, 0xFF55FF55, config.isHudShadow());
                    f.updateHudBounds(x, f.getHudY(), 85, 22);
                }));

        register(new Feature("Geschwindigkeit", "Zeigt Bewegungsgeschwindigkeit", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p != null) {
                        double spd = Math.sqrt(p.getDeltaMovement().x * p.getDeltaMovement().x + p.getDeltaMovement().z * p.getDeltaMovement().z) * 20;
                        drawHud(g, f, String.format("%.2f m/s", spd));
                    }
                }));

        register(new Feature("Spielzeit", "Zeigt Session-Dauer", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    long e = System.currentTimeMillis() - sessionStart;
                    drawHud(g, f, String.format("%02d:%02d:%02d", e / 3600000, (e % 3600000) / 60000, (e % 60000) / 1000));
                }));

        register(new Feature("Ingame Tag", "Zeigt Ingame-Tag", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    if (Minecraft.getInstance().level != null)
                        drawHud(g, f, "" + (Minecraft.getInstance().level.getGameTime() / 24000L));
                }));

        register(new Feature("Richtung", "Zeigt Blickrichtung", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p == null) return;
                    String d = switch (p.getDirection()) {
                        case NORTH -> "Nord (-Z)"; case SOUTH -> "Süd (+Z)";
                        case EAST -> "Ost (+X)"; case WEST -> "West (-X)";
                        default -> "?";
                    };
                    drawHud(g, f, d);
                }));

        register(new Feature("Erreichweite", "Zeigt Reichweite", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "3.0")));

        register(new Feature("Item Zähler", "Zählt Items", FeatureCategory.HUD)
                .setSetting("item", "totem_of_undying")
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p == null) return;
                    String itemId = f.getSetting("item", "totem_of_undying");
                    int count = 0;
                    net.minecraft.world.item.Item targetItem = net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(itemId)).get().value();
                    for (int i = 0; i < p.getInventory().getContainerSize(); i++) {
                        ItemStack stack = p.getInventory().getItem(i);
                        if (stack.is(targetItem)) count += stack.getCount();
                    }
                    int x = f.getHudX(), y = f.getHudY();
                    Minecraft mc = Minecraft.getInstance();
                    int bg = f.getHudBgColor();
                    if (bg != 0) {
                        g.fill(x - 2, y - 1, x + 18, y + 17, bg);
                    }
                    ItemStack displayStack = new ItemStack(targetItem);
                    g.renderItem(displayStack, x, y);
                    g.renderItemDecorations(mc.font, displayStack, x, y);
                    String countStr = " " + count;
                    g.drawString(mc.font, countStr, x + 18, y + 3, f.getHudTextColor() | 0xFF000000, config.isHudShadow());
                    f.updateHudBounds(x, y, 18 + mc.font.width(countStr), 18);
                }));

        register(new Feature("Shulker Vorschau", "Zeigt Shulker-Inhalt", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "Im Hand")));

        register(new Feature("Lebensanzeige", "Zeigt Leben", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> {
                    LocalPlayer p = Minecraft.getInstance().player;
                    if (p != null) drawHud(g, f, String.format("%.1f / %.1f", p.getHealth(), p.getMaxHealth()));
                }));

        register(new Feature("RP Anzeige", "Zeigt Resourcepacks", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "Aktiv")));

        register(new Feature("TNT Timer", "Zeigt TNT-Zünder", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "Keins")));

        register(new Feature("Titel", "Zeigt Titel", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "Aktiv")));

        register(new Feature("Scoreboard", "Zeigt Scoreboard", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "Sichtbar")));

        register(new Feature("Actionbar", "Zeigt Actionbar", FeatureCategory.HUD)
                .setHudRenderer((g, f) -> drawHud(g, f, "Aktiv")));

        // === VISUAL ===
        register(new Feature("Fullbright", "Volle Helligkeit", FeatureCategory.VISUAL)
                .onToggle(f -> {
                    Minecraft mc = Minecraft.getInstance();
                    if (mc.options != null) mc.options.gamma().set(f.isEnabled() ? 1.0 : 0.1);
                }));

        register(new Feature("Freelook", "Freie Kamera (V)", FeatureCategory.VISUAL));
        register(new Feature("Nametags", "Verbesserte Namens-Anzeigen", FeatureCategory.VISUAL).setDefault(true));
        register(new Feature("FOV Changer", "FOV ändern", FeatureCategory.VISUAL).setSetting("fov", 90));
        register(new Feature("Farbsättigung", "Erhöhte Farbsättigung", FeatureCategory.VISUAL));
        register(new Feature("Motion Blur", "Bewegungsunschärfe", FeatureCategory.VISUAL).setSetting("strength", 5));
        register(new Feature("Kein Nebel", "Entfernt Nebel", FeatureCategory.VISUAL));
        register(new Feature("Block Outlines", "Block-Umriss", FeatureCategory.VISUAL).setDefault(true));
        register(new Feature("Partikel", "Erweiterte Partikel", FeatureCategory.VISUAL).setDefault(true));
        register(new Feature("Custom Crosshair", "Eigener Fadenkreuz", FeatureCategory.VISUAL).setSetting("color", 0xFFFFFF).setSetting("shape", "plus"));
        register(new Feature("Hit Color", "Treffer-Farbe", FeatureCategory.VISUAL).setSetting("color", 0xFF0000));
        register(new Feature("Hitbox", "Entity-Hitboxen", FeatureCategory.VISUAL));
        register(new Feature("Glint Farbe", "Verzauberungs-Glint", FeatureCategory.VISUAL).setSetting("color", 0xFF00FF));
        register(new Feature("Low Fire", "Feuer-Overlay niedriger", FeatureCategory.VISUAL));
        register(new Feature("Seitenschild", "Schild-Seiten-Animation", FeatureCategory.VISUAL));
        register(new Feature("Kein Hurtcam", "Kein Schaden-Wackeln", FeatureCategory.VISUAL));
        register(new Feature("Wavy Capes", "Wellenförmige Capes", FeatureCategory.VISUAL));
        register(new Feature("Klarer Hintergrund", "Transparenter Menü-Hintergrund", FeatureCategory.VISUAL));
        register(new Feature("Shiny Tränke", "Glänzende Trankflaschen", FeatureCategory.VISUAL));
        register(new Feature("Alte Animationen", "Klassische Animationen", FeatureCategory.VISUAL));
        register(new Feature("3D Skin", "3D-Skin-Rendering", FeatureCategory.VISUAL));
        register(new Feature("Randloser Vollbild", "Randloses Fenster", FeatureCategory.VISUAL));
        register(new Feature("Item Modell", "Eigene Item-Modelle", FeatureCategory.VISUAL));

        // === COMBAT ===
        register(new Feature("Reach Display", "Zeigt Reichweite", FeatureCategory.COMBAT));

        // === WORLD ===
        register(new Feature("Wetter ändern", "Wetter kontrollieren", FeatureCategory.WORLD).setSetting("weather", "clear"));
        register(new Feature("Zeit ändern", "Tageszeit kontrollieren", FeatureCategory.WORLD).setSetting("time", 6000));
        register(new Feature("Waypoints", "Wegpunkte setzen", FeatureCategory.WORLD));

        // === UTILITY ===
        register(new Feature("Drop Stack", "Schnell Stack droppen", FeatureCategory.UTILITY).setKeyBind(74));
        register(new Feature("Screenshot", "Verbesserte Screenshots", FeatureCategory.UTILITY).setDefault(true).setKeyBind(67));
        register(new Feature("Auto Text", "Automatische Nachrichten", FeatureCategory.UTILITY).setSetting("interval", 60));
        register(new Feature("Auto Reconnect", "Automatisch reconnecten", FeatureCategory.UTILITY).setDefault(true).setSetting("delay", 5));
        register(new Feature("Streamer Mode", "Sensible Infos verbergen", FeatureCategory.UTILITY));
        register(new Feature("Pack Tweaks", "Resourcepack Optimierungen", FeatureCategory.UTILITY));

        // === SOCIAL ===
        register(new Feature("Chat Heads", "Köpfe im Chat", FeatureCategory.SOCIAL).setDefault(true));
        register(new Feature("Freunde", "Freundesliste", FeatureCategory.SOCIAL));
        register(new Feature("Pings", "Orte markieren", FeatureCategory.SOCIAL).setKeyBind(80));
        register(new Feature("Emotes", "Emote-Rad", FeatureCategory.SOCIAL));

        // === CHAT ===
        register(new Feature("Tips", "Hilfreiche Tipps", FeatureCategory.CHAT).setDefault(true));
        register(new Feature("Nachrichten", "Chat anpassen", FeatureCategory.CHAT).setDefault(true));

        // === MOTION ===
        register(new Feature("Toggle Sprint", "Permanent sprinten", FeatureCategory.MOTION));
        register(new Feature("Toggle Sneak", "Permanent schleichen", FeatureCategory.MOTION));

        // === SETTINGS ===
        register(new Feature("GUI Skalierung", "Menü-Größe", FeatureCategory.SETTINGS).setSetting("scale", 2));
        register(new Feature("Theme", "Farbschema", FeatureCategory.SETTINGS).setSetting("primary", 0x55FF55).setSetting("secondary", 0x5555FF).setSetting("background", 0x202020));
        register(new Feature("Profile", "Einstellungs-Profile", FeatureCategory.SETTINGS));
        register(new Feature("Discord Integration", "Discord Rich Presence", FeatureCategory.SETTINGS));
        register(new Feature("Spotify Overlay", "Spotify Anzeige", FeatureCategory.SETTINGS));
        register(new Feature("Cosmetics", "Kosmetik-Features", FeatureCategory.SETTINGS));
        register(new Feature("RP Organiser", "Resourcepack Organisation", FeatureCategory.SETTINGS));
        register(new Feature("Crux+", "Premium Features", FeatureCategory.SETTINGS).setSettingsOnly(true));
        register(new Feature("Icon", "Mod-Icon anpassen", FeatureCategory.SETTINGS).setSettingsOnly(true));
    }

    private void loadFromConfig() {
        int defaultY = 4;

        Map<String, Boolean> toggles = config.getFeatureToggles();
        Map<String, Map<String, Object>> settings = config.getFeatureSettings();

        for (Feature f : features) {
            if (toggles.containsKey(f.getName())) {
                f.setEnabled(toggles.get(f.getName()));
            }

            if (settings.containsKey(f.getName())) {
                f.getSettings().putAll(settings.get(f.getName()));
            }

            int textColor = config.getHudTextColor(f.getName());
            int bgColor = config.getHudBgColor(f.getName());
            if (textColor != 0x55FF55) f.setHudTextColor(textColor);
            if (bgColor != 0) f.setHudBgColor(bgColor);

            int kb = config.getKeyBind(f.getName());
            if (kb != -1) f.setKeyBindDirect(kb);

            int[] pos = config.getHudPosition(f.getName());
            if (pos != null) {
                f.setHudPos(pos[0], pos[1]);
            } else if (f.hasHudRenderer()) {
                f.setHudPos(4, defaultY);
                defaultY += 12;
            }
        }
    }

    private void drawHud(GuiGraphics g, Feature f, String text) {
        Minecraft mc = Minecraft.getInstance();
        int color = f.getHudTextColor() | 0xFF000000;
        int bg = f.getHudBgColor();
        int textW = mc.font.width(text);
        int textH = 11;
        if (bg != 0) {
            g.fill(f.getHudX() - 2, f.getHudY() - 1, f.getHudX() + textW + 2, f.getHudY() + textH + 1, bg);
        }
        g.drawString(mc.font, text, f.getHudX(), f.getHudY(), color, config.isHudShadow());
        f.updateHudBounds(f.getHudX(), f.getHudY(), textW, textH);
    }

    private void drawAt(GuiGraphics g, int x, int y, String text) {
        Minecraft mc = Minecraft.getInstance();
        int color = 0xFF55FF55;
        g.drawString(mc.font, text, x, y, color, config.isHudShadow());
    }

    private void drawKey(GuiGraphics g, int x, int y, String key, boolean pressed) {
        int bg = pressed ? 0xFFFFFF55 : 0x80000000;
        int fg = pressed ? 0xFFFFFF00 : 0xFFAAAAAA;
        g.fill(x, y, x + 16, y + 16, bg);
        g.drawCenteredString(Minecraft.getInstance().font, key, x + 8, y + 4, fg);
    }

    public List<Feature> getAll() { return features; }
    public List<Feature> getByCategory(FeatureCategory category) { return categorized.getOrDefault(category, Collections.emptyList()); }

    public Feature getByName(String name) {
        return features.stream().filter(f -> f.getName().equals(name)).findFirst().orElse(null);
    }

    public Feature getFeatureAt(int mouseX, int mouseY) {
        for (Feature f : features) {
            if (f.hasHudRenderer() && f.isEnabled() && f.isMouseOver(mouseX, mouseY)) return f;
        }
        return null;
    }

    public void tick() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null) return;

        long now = System.currentTimeMillis();
        if (now - lastSecondTime >= 1000) {
            leftClicks.set(clicksThisSecond);
            clicksThisSecond = 0;
            lastSecondTime = now;
        }

        if (now - lastHitTime > 2000) comboCount = 0;

        Feature ts = getByName("Toggle Sprint");
        if (ts != null && ts.isEnabled() && mc.player.input.hasForwardImpulse()) mc.player.setSprinting(true);

        Feature sneak = getByName("Toggle Sneak");
        if (sneak != null) mc.player.setShiftKeyDown(sneak.isEnabled());
    }

    public void onLeftClick() { clicksThisSecond++; }
    public void onAttack() {
        long now = System.currentTimeMillis();
        if (now - lastHitTime > 100) {
            comboCount++;
            lastHitTime = now;
        }
    }

    public void syncToConfig() {
        for (Feature f : features) {
            config.getFeatureToggles().put(f.getName(), f.isEnabled());
            if (!f.getSettings().isEmpty()) {
                config.getFeatureSettings().put(f.getName(), new HashMap<>(f.getSettings()));
            }
            config.setHudPosition(f.getName(), f.getHudX(), f.getHudY());
            config.setHudTextColor(f.getName(), f.getHudTextColor());
            config.setHudBgColor(f.getName(), f.getHudBgColor());
            if (f.getKeyBind() != -1) config.setKeyBind(f.getName(), f.getKeyBind());
        }
    }
}
