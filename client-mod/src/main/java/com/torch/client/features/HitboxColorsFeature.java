package com.torch.client.features;

import com.torch.client.TorchClientMod;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.WorldRenderer;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.entity.passive.PassiveEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.scoreboard.Team;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

public class HitboxColorsFeature {
  private static boolean registered = false;

  public static void register() {
    if (registered) return;
    registered = true;

    WorldRenderEvents.AFTER_ENTITIES.register(context -> {
      if (TorchClientMod.getConfig() == null || !TorchClientMod.getConfig().features.hitboxColors) return;

      var world = context.world();
      var camera = context.camera();
      if (world == null || camera == null) return;

      Vec3d camPos = camera.getPos();
      var matrices = context.matrixStack();
      var consumers = context.consumers();

      if (matrices == null || consumers == null) return;

      var vertexConsumer = consumers.getBuffer(RenderLayer.getLines());

      for (Entity entity : world.getEntities()) {
        if (entity == camera.getFocusedEntity()) continue;

        Box box = entity.getBoundingBox().offset(-camPos.x, -camPos.y, -camPos.z);
        float[] color = getEntityColor(entity);
        WorldRenderer.drawBox(matrices, vertexConsumer, box, color[0], color[1], color[2], 0.6f);
      }
    });
  }

  private static float[] getEntityColor(Entity entity) {
    Team team = entity.getScoreboardTeam();
    if (team != null && team.getColor() != null) {
      Integer colorValue = team.getColor().getColorValue();
      if (colorValue != null) {
        return new float[]{
          ((colorValue >> 16) & 0xFF) / 255f,
          ((colorValue >> 8) & 0xFF) / 255f,
          (colorValue & 0xFF) / 255f
        };
      }
    }

    if (entity instanceof PlayerEntity) {
      return new float[]{0.3f, 0.7f, 1.0f};
    } else if (entity instanceof HostileEntity) {
      return new float[]{1.0f, 0.2f, 0.2f};
    } else if (entity instanceof PassiveEntity) {
      return new float[]{0.3f, 1.0f, 0.3f};
    } else if (entity instanceof LivingEntity) {
      return new float[]{0.8f, 0.8f, 0.2f};
    } else {
      return new float[]{0.6f, 0.6f, 0.6f};
    }
  }
}
