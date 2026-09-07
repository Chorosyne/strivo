    case "pipelines":
      await renderPipelines();
      break;
    case "plugins":
      await renderPlugins();
      break;
    case "studio":
      await renderProApp("studio");
      break;
    case "analytics":
      await renderProApp("analytics");
      break;
    case "publish":
      await renderProApp("publish");
      break;
