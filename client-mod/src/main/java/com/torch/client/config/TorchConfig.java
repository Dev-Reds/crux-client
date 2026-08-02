package com.torch.client.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Path;

public class TorchConfig {
  public boolean enabled = true;
  public Features features = new Features();
  public Theme theme = new Theme();

  public static class Features {
    public boolean zoom = true;
    public boolean fullbright = false;
    public boolean betterTooltips = true;
    public boolean hitboxColors = false;
    public boolean motionBlur = false;
  }

  public static class Theme {
    public String backgroundColor = "#0a0a0a";
    public String accentColor = "#0088ff";
    public String textColor = "#ffffff";
    public String secondaryColor = "#888888";
    public String borderColor = "#2a2a2a";
  }

  private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
  private static TorchConfig instance;

  public static TorchConfig load() {
    if (instance != null) return instance;
    Path configPath = FabricLoader.getInstance().getGameDir().resolve("config/torchclient.json");
    if (configPath.toFile().exists()) {
      try (FileReader reader = new FileReader(configPath.toFile())) {
        instance = GSON.fromJson(reader, TorchConfig.class);
        if (instance == null) instance = new TorchConfig();
        if (instance.features == null) instance.features = new Features();
        if (instance.theme == null) instance.theme = new Theme();
      } catch (IOException e) {
        instance = new TorchConfig();
      }
    } else {
      instance = new TorchConfig();
    }
    return instance;
  }

  public static TorchConfig getConfig() {
    if (instance == null) return load();
    return instance;
  }

  public void save() {
    Path configPath = FabricLoader.getInstance().getGameDir().resolve("config/torchclient.json");
    try (FileWriter writer = new FileWriter(configPath.toFile())) {
      GSON.toJson(this, writer);
    } catch (IOException e) {
      e.printStackTrace();
    }
  }
}
