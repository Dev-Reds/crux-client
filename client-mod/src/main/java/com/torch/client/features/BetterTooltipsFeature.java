package com.torch.client.features;

import com.torch.client.TorchClientMod;
import net.fabricmc.fabric.api.client.item.v1.ItemTooltipCallback;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.FoodComponent;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

public class BetterTooltipsFeature {
  private static boolean registered = false;

  public static void register() {
    if (registered) return;
    registered = true;

    ItemTooltipCallback.EVENT.register((stack, context, type, lines) -> {
      if (TorchClientMod.getConfig() == null || !TorchClientMod.getConfig().features.betterTooltips) return;

      if (stack.isDamageable()) {
        int maxDmg = stack.getMaxDamage();
        int dmg = stack.getDamage();
        int remaining = maxDmg - dmg;

        lines.add(Text.empty());
        lines.add(Text.literal("Durability: ").formatted(Formatting.GRAY)
          .append(Text.literal(String.valueOf(remaining)).formatted(Formatting.WHITE))
          .append(Text.literal(" / ").formatted(Formatting.GRAY))
          .append(Text.literal(String.valueOf(maxDmg)).formatted(Formatting.WHITE)));

        float pct = (float) remaining / maxDmg;
        int color;
        if (pct > 0.6) color = 0xFF55FF55;
        else if (pct > 0.3) color = 0xFFFFAA00;
        else color = 0xFFFF5555;
        lines.add(Text.literal("||||||||||||||||||||").styled(s -> s.withColor(color)));
      }

      if (Screen.hasShiftDown()) {
        FoodComponent food = stack.get(DataComponentTypes.FOOD);
        if (food != null) {
          lines.add(Text.empty());
          lines.add(Text.literal("Hunger: ").formatted(Formatting.GRAY)
            .append(Text.literal(String.valueOf(food.nutrition())).formatted(Formatting.GOLD)));
          lines.add(Text.literal("Saturation: ").formatted(Formatting.GRAY)
            .append(Text.literal(String.format("%.1f", food.saturation())).formatted(Formatting.GOLD)));
        }
      }
    });
  }
}
